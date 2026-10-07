/**
 * The PostgreSQL connection.
 *
 * This module and `database/` are the **only** places allowed to hold a
 * database connection or to import Drizzle for this engine. Neither the React
 * application nor the Tauri shell ever connects to PostgreSQL, and the API
 * wiring reaches this module through `persistence/connection.ts`, which is the
 * one place that decides which engine answers a `DATABASE_URL` (ADR 0025).
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@denti-code-u3/database/schema';

/**
 * The typed database handle. Every repository in `infrastructure/persistence`
 * takes this type, so a schema change surfaces as a compile error at every call
 * site instead of as a wrong query at runtime.
 */
export type DentiDatabase = PostgresJsDatabase<typeof schema>;

export interface PostgresConnection {
  readonly db: DentiDatabase;
  /** The underlying postgres.js client. */
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

export function createPostgresConnection(connectionString: string): PostgresConnection {
  const sql = postgres(connectionString, {
    max: 10,
    // Fail fast instead of queueing requests forever when the database is down.
    connect_timeout: 10,
    idle_timeout: 30,
    onnotice: () => {
      /* notices are development noise, not application logs */
    },
  });

  const db = drizzle(sql, { schema, casing: 'snake_case' });

  return {
    db,
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
