/**
 * Applies pending migrations to PostgreSQL.
 *
 * Run with `pnpm run db:migrate`. Migrations are plain SQL in
 * `database/migrations`, applied in order and recorded in
 * `database/migrations/meta/_journal.json`, so applying twice is a no-op.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(78);
}

const here = path.dirname(fileURLToPath(import.meta.url));
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
