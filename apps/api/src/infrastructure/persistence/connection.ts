/**
 * The database connection seam — the engine is chosen by the URL scheme.
 *
 * ADR 0025 kept the PostgreSQL engine as a second implementation after SQLite
 * became the default. The API's wiring continues to talk to *a*
 * `DatabaseConnection`; this module is the only place that decides which of the
 * two engines a `DATABASE_URL` opens. Routes receive ports (`repositories`,
 * `unitOfWork`, `dashboard`), never a driver handle, so nothing above this file
 * has to know which engine answered.
 *
 * This module and `database/` are the **only** places allowed to open a database
 * connection or to import a Drizzle engine entry point. Neither the React
 * application nor the Tauri shell ever connects to a database.
 */

import type { Repositories, UnitOfWork } from '@denti-code-u3/domain';

import { isSqliteUrl } from '@denti-code-u3/database/db-url';
import type { DashboardReadStore } from '../../application/dashboard-read-store.js';
import { createPostgresConnection } from './postgres/connection.js';
import { PostgresDashboardReadStore } from './postgres/dashboard-store.js';
import { DrizzleUnitOfWork } from './postgres/unit-of-work.js';
import { createSqliteConnection, type SqliteDatabase } from './sqlite/connection.js';
import { SQLiteDashboardReadStore } from './sqlite/dashboard-store.js';
import { SQLiteUnitOfWork } from './sqlite/unit-of-work.js';
import { sqliteRepositoriesFor } from './sqlite/repositories.js';
import { repositoriesFor } from './postgres/unit-of-work.js';

/** The two engines a `DATABASE_URL` can name (ADR 0025). */
export type DatabaseEngine = 'postgresql' | 'sqlite';

export interface DatabaseConnection {
  readonly engine: DatabaseEngine;
  /**
   * One repository per domain port, built on the connection's own handle. The
   * unit-of-work builds a *fresh* set per transaction, so these are the
   * non-transactional routes' repositories — see `postgres/unit-of-work.ts` for
   * why a repository built elsewhere must never be used inside a transaction.
   */
  readonly repositories: Repositories;
  readonly unitOfWork: UnitOfWork;
  readonly dashboard: DashboardReadStore;
  /** `true` when the database answers — used by the readiness probe. */
  isReachable(): Promise<boolean>;
  close(): Promise<void> | void;
}

export function openDatabaseConnection(
  databaseUrl: string,
  fallbackTimeZone: string,
): DatabaseConnection {
  if (isSqliteUrl(databaseUrl)) {
    return openSqlite(databaseUrl, fallbackTimeZone);
  }
  return openPostgres(databaseUrl, fallbackTimeZone);
}

function openPostgres(databaseUrl: string, fallbackTimeZone: string): DatabaseConnection {
  const { db, sql, close } = createPostgresConnection(databaseUrl);

  return {
    engine: 'postgresql',
    repositories: repositoriesFor(db),
    unitOfWork: new DrizzleUnitOfWork(db),
    dashboard: new PostgresDashboardReadStore(db, fallbackTimeZone),
    isReachable: async () => {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    close,
  };
}

function openSqlite(databaseUrl: string, fallbackTimeZone: string): DatabaseConnection {
  const { db, client, close } = createSqliteConnection(databaseUrl);

  return {
    engine: 'sqlite',
    repositories: sqliteRepositoriesFor(db),
    unitOfWork: new SQLiteUnitOfWork(client, db, sqliteRepositoriesFor),
    dashboard: new SQLiteDashboardReadStore(db, fallbackTimeZone),
    isReachable: () => {
      try {
        client.prepare('select 1').get();
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    },
    close,
  };
}

export type { SqliteDatabase };
export type { DentiDatabase } from './postgres/connection.js';
