/**
 * The transaction boundary, on SQLite.
 *
 * The equivalent of `postgres/unit-of-work.ts` for the SQLite engine, with one
 * structural difference dictated by the driver:
 *
 * **better-sqlite3's `db.transaction()` refuses async callbacks** — a
 * transaction function cannot return a promise. The domain's `UnitOfWork`
 * contract is `work` returning a `Promise`, so this implementation manages the
 * transaction itself with `BEGIN` and `COMMIT`/`ROLLBACK` on the connection.
 * That is safe here because the connection is synchronous and exclusive to this
 * process (see `connection.ts`): everything between the `BEGIN` and the next
 * statement runs on one connection with no interleaving, so the transaction is
 * not at the mercy of the event loop in the way a pooled connection would be.
 *
 * Everything else mirrors the PostgreSQL implementation, deliberately:
 *
 * - **The repositories are built per transaction, not shared.** A repository
 *   holds the database handle it was constructed with, so reusing one built on
 *   the outer connection inside a transaction would quietly write outside it
 *   (ADR 0021). `sqliteRepositoriesFor` is the per-transaction builder; the
 *   outer connection builds its own set with the same function. (Both are
 *   bound to the same single connection, so the *handle* is shared even though
 *   the *repositories* never are.)
 * - **No retry, ever.** A `DomainError` raised inside `work` rolls back the
 *   transaction and propagates unchanged; the refusal is an answer, not a
 *   temporary condition to paper over.
 */
import type { Repositories, UnitOfWork } from '@denti-code-u3/domain';
import type Database from 'better-sqlite3';

import { sqliteRepositoriesFor } from './repositories.js';
import type { SqliteDatabase } from './connection.js';

/**
 * A `UnitOfWork` whose transactions are SQLite transactions.
 *
 * `work` runs between `BEGIN` and `COMMIT`; any throw — a scheduling conflict,
 * a domain refusal, a constraint — calls `ROLLBACK` before the error reaches
 * its caller, so the use case's refusals leave no half-written rows. If `work`
 * rejects before any statement ran, SQLite has no active transaction and the
 * best-effort `ROLLBACK` is swallowed, because there was nothing to undo.
 */
export class SQLiteUnitOfWork implements UnitOfWork {
  constructor(
    private readonly client: Database.Database,
    private readonly db: SqliteDatabase,
    private readonly buildRepositories: (
      db: SqliteDatabase,
    ) => Repositories = sqliteRepositoriesFor,
  ) {}

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    this.client.exec('BEGIN');
    try {
      const result = await work(this.buildRepositories(this.db));
      this.client.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.client.exec('ROLLBACK');
      } catch {
        /* no transaction was active; nothing to undo */
      }
      throw error;
    }
  }
}
