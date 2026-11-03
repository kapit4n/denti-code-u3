/**
 * Applies pending migrations to the engine `DATABASE_URL` names.
 *
 * Run with `pnpm run db:migrate`. The engine is chosen by the URL scheme
 * (ADR 0025): a `postgres:` URL applies `database/migrations`, a `sqlite:` or
 * `file:` URL applies `database/migrations-sqlite`. Migrations are plain SQL,
 * applied in order and recorded in the matching `meta/_journal.json`, so
 * applying twice is a no-op.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Database from 'better-sqlite3';
import { drizzle as sqliteDrizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as sqliteMigrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';
import { isSqliteUrl, sqliteDatabasePath, ensureSqliteDatabaseDirectory } from './db-url.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(78);
}

const here = path.dirname(fileURLToPath(import.meta.url));

if (isSqliteUrl(databaseUrl)) {
  const migrationsFolder = path.join(here, 'migrations-sqlite');
  ensureSqliteDatabaseDirectory(databaseUrl);
  const client = new Database(sqliteDatabasePath(databaseUrl));
  // Drizzle rebuilds a table to change a column default. SQLite refuses to drop
  // a table that is still referenced while foreign keys are enforced, and a
  // `PRAGMA foreign_keys` inside the migration's transaction is ignored — so the
  // switch has to happen outside it. The integrity check below is the counterweight:
  // a rebuild that broke a reference fails the migration instead of hiding it.
  client.pragma('foreign_keys = OFF');

  const db = sqliteDrizzle(client, { schema: sqliteSchema, casing: 'snake_case' });

  try {
    console.log(`Applying SQLite migrations from ${migrationsFolder}`);
    sqliteMigrate(db, { migrationsFolder });
    client.pragma('foreign_keys = ON');
    const violations = client.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      throw new Error(`Foreign key check failed after migration: ${JSON.stringify(violations)}`);
    }
    console.log('Migrations applied.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.close();
  }
} else {
  const migrationsFolder = path.join(here, 'migrations');
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { casing: 'snake_case' });

  try {
    console.log(`Applying migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied.');
    process.exitCode = 0;
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
