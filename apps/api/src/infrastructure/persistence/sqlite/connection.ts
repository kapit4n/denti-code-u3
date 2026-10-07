/**
 * The SQLite connection.
 *
 * One synchronous connection on purpose. better-sqlite3 is synchronous, so a
 * second connection to the same file would have to coordinate with this one
 * through SQLite's locking rather than through the process's event loop. One
 * connection makes every statement evaluation-safe and makes the patient
 * registration's read-then-insert an atomic critical section without a lock.
 * Both facts are documented at the unit-of-work that runs on top of it.
 *
 * This module and `database/` are the **only** places allowed to hold a
 * database connection or to import Drizzle for this engine (ADR 0025). The API
 * wiring reaches it through `persistence/connection.ts`, which is the one place
 * that decides which engine answers a `DATABASE_URL`.
 */

import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';
import { sqliteDatabasePath } from '@denti-code-u3/database/db-url';
import { foldAccents } from '../fold-accents.js';

/**
 * The typed SQLite database handle, with the SQLite schema tree.
 *
 * Mirrors `postgres/connection.ts`'s `DentiDatabase`: every SQLite repository
 * and the SQLite read store take this type, so a change to the SQLite schema
 * surfaces as a compile error at every SQLite call site.
 */
export type SqliteDatabase = BetterSQLite3Database<typeof sqliteSchema>;

export interface SqliteDatabaseConnection {
  readonly db: SqliteDatabase;
  /** The underlying better-sqlite3 handle. */
  readonly client: Database.Database;
  close(): void;
}

/**
 * Open the file a `sqlite:`/`file:` URL names.
 *
 * The path is resolved by `@denti-code-u3/database/db-url` — the same resolver
 * the migrator and the seeder use — so the API, the migrator and the seeder
 * always name the *same file*, whatever directory each process started from.
 * Better-sqlite3 wants a filesystem path, not a URL: handing it the URL string
 * would both open the wrong thing and refuse its relative form.
 */
export function createSqliteConnection(databaseUrl: string): SqliteDatabaseConnection {
  const client = new Database(sqliteDatabasePath(databaseUrl));

  // SQLite defaults to foreign keys OFF per connection, and every row in this
  // schema is a composite foreign key (ADR 0014). Migrate, seed and API all set
  // this — a connection that forgot would silently accept rows across clinics.
  client.pragma('foreign_keys = ON');

  // The accent fold as a scalar function, so the search and list queries can
  // call it (the SQLite inside this better-sqlite3 has no `translate()`).
  // `deterministic` lets SQLite use it in an index expression.
  client.function('fold_accents', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? foldAccents(value) : null,
  );

  const db = drizzle(client, { schema: sqliteSchema, casing: 'snake_case' });

  return {
    db,
    client,
    close() {
      client.close();
    },
  };
}

export { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
