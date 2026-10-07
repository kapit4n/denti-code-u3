/**
 * Denti-Code U3 SQLite schema — the second Drizzle declaration of the same
 * bounded areas (ADR 0025).
 *
 * This is a full tree of its own, not a variant of `../schema`. Both declare
 * the same tables, in the same bounded areas, with the same names, so that a
 * column added to one and forgotten in the other fails `pnpm run typecheck`
 * rather than failing at runtime against whichever engine is not selected.
 *
 * Two deliberate differences from `../schema/index.ts`:
 *
 *  - There is no `enums.js`. PostgreSQL needs `pgEnum` values declared in the
 *    database; SQLite stores `text` and the value list lives with the domain
 *    (`@denti-code-u3/domain`), which both engines read.
 *  - There is no `relations.js` export: nothing uses Drizzle's relational
 *    query API, so a second set would be code with no caller.
 *
 * `defaults.js` is not re-exported either — it exists for these files only.
 */

export * from './organization.js';
export * from './patient.js';
export * from './appointment.js';
export * from './visit.js';
export * from './treatment.js';
export * from './billing.js';
export * from './inventory.js';
