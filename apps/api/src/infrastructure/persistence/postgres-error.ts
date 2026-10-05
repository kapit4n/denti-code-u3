/**
 * Reading PostgreSQL's refusals as domain answers.
 *
 * A constraint violation arrives as an error object with a `code` buried somewhere in
 * its `cause` chain, and a repository that does not recognise it turns the clinic's
 * most common mistake into a 500 with a request id. That happened once: the
 * `appointments_dentist_same_clinic_fk` error is nested two levels deep, and a reader
 * who looked on the wrong object found `undefined` for every error.
 *
 * So the codes, the walk that finds them, and the translations live here rather than in
 * whichever repository happened to need them first. `appointment-repository.ts` was
 * written with this logic inline; `visit-repository.ts` needed the same two answers
 * and copying them would have left two places to update when a driver changes how it
 * wraps an error.
 *
 * **These are translations, not rules.** What counts as a conflict, and who may be
 * booked, is decided in the domain (ADR 0018, ADR 0020, ADR 0021). This module only
 * decides how a refusal the database already made is spelled for a client.
 */

/** `exclusion_violation`: two rows overlap where a constraint says they may not. */
export const PG_EXCLUSION_VIOLATION = '23P01';

/** `foreign_key_violation`: the row names something that is not there, or not here. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/** `unique_violation`: a second row for a key that must be unique. */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * How far down the `cause` chain to look.
 *
 * Five is not a guess about depth so much as a bound: the chain is walked rather than
 * unwrapped, because a driver that hands back a cyclic cause would otherwise hang the
 * API's error path. Two is the deepest this project has seen.
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether `error`, or anything in its `cause` chain, carries this SQLSTATE.
 *
 * A chain walk rather than a recursive one, so the bound is visible at the loop.
 */
export function hasPostgresCode(error: unknown, code: string): boolean {
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if ((current as { readonly code?: unknown }).code === code) {
      return true;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }

  return false;
}

/** `true` when the database refused a write because two rows overlap. */
export function isExclusionViolation(error: unknown): boolean {
  return hasPostgresCode(error, PG_EXCLUSION_VIOLATION);
}

/**
 * `true` when the database refused a write because a unique index already holds that
 * key.
 *
 * What the patient record number and `visits_appointment_uq` both answer with, and for
 * the same reason: two writers raced, and the index is the only place both of them
 * were visible at once.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasPostgresCode(error, PG_UNIQUE_VIOLATION);
}
