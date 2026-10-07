/**
 * SQLite's own constraint refusals, named and probed.
 *
 * The PostgreSQL side has `postgres-error.ts` for the same task. SQLite does not
 * have `23P01`/`23503`/`23505`; it throws `SqliteError` with a string code and
 * a human-readable message. Three codes matter to this application, and this
 * file is the only place that knows their strings — the repositories map them
 * to their own `DomainError`s, exactly as the PostgreSQL repositories map
 * theirs (ADR 0025).
 */

import { SqliteError } from 'better-sqlite3';

/** A composite foreign key refused the row: a reference the clinic does not hold. */
export const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';
/** An index refused a duplicate — the record-number or visit-once indexes. */
export const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
/** A trigger refused the write — the appointment overlap guards. */
export const SQLITE_CONSTRAINT_TRIGGER = 'SQLITE_CONSTRAINT_TRIGGER';
export const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';

/**
 * Every `raise(abort, ...)` the overlap triggers use begins with this, so the
 * repositories can tell our two guards apart from a trigger that belongs to
 * something else. It must match `database/migrations-sqlite/0001_...` verbatim.
 */
export const SCHEDULING_CONFLICT_MESSAGE_PREFIX = 'appointment overlaps another appointment';

/** The code a better-sqlite3 `SqliteError` carries, without trusting the import. */
export function hasSqliteCode(error: unknown, code: string): boolean {
  if (error instanceof SqliteError) {
    return error.code === code;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: unknown }).code === code;
  }
  return false;
}

/** A row the composite foreign keys refused — patient, dentist, chair or room. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasSqliteCode(error, SQLITE_CONSTRAINT_FOREIGNKEY);
}

export function isUniqueViolation(error: unknown): boolean {
  return hasSqliteCode(error, SQLITE_CONSTRAINT_UNIQUE);
}

/** One of the appointment overlap triggers refused the write. */
export function isSchedulingConflict(error: unknown): boolean {
  if (!hasSqliteCode(error, SQLITE_CONSTRAINT_TRIGGER)) {
    return false;
  }
  const message =
    error instanceof Error ? error.message : (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.startsWith(SCHEDULING_CONFLICT_MESSAGE_PREFIX);
}

export { SqliteError };
