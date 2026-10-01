/**
 * The PostgreSQL connection.
 *
 * This module and `database/` are the **only** places allowed to hold a
 * database connection or to import Drizzle. Neither the React application nor the
 * Tauri shell ever connects to PostgreSQL.
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

export interface DatabaseConnection {
  readonly db: DentiDatabase;
  /** The underlying postgres.js client. */
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

export function createDatabaseConnection(connectionString: string): DatabaseConnection {
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

/** `true` when the database answers — used by the health probe. */
export async function isDatabaseReachable(connection: DatabaseConnection): Promise<boolean> {
  try {
    await connection.sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
