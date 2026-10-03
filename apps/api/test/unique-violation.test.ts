/**
 * `isUniqueViolation` reads the Postgres error code off the right object.
 *
 * This is worth a unit test on its own. The obvious implementation —
 * `(error as { code }).code === '23505'` — returns `undefined` for every real
 * database error, because Drizzle rethrows driver failures wrapped in its own
 * `DrizzleQueryError` with the original moved to `cause`. A test written against
 * a bare `{ code: '23505' }` would have passed while the production path silently
 * turned every conflict into a 500.
 *
 * No database needed: the shapes are the only input.
 */

import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from '../src/infrastructure/persistence/repositories/patient-repository.js';

/** A bare driver error, as `postgres-js` throws it. */
function driverError(code: string): object {
  return { name: 'PostgresError', code, severity: 'ERROR' };
}

/** How Drizzle rethrows it: the driver error moved to `cause`. */
function drizzleQueryError(cause: object): object {
  return { name: 'DrizzleQueryError', message: 'Failed query: insert into "patients"…', cause };
}

describe('isUniqueViolation', () => {
  it('recognises a unique violation thrown directly by the driver', () => {
    expect(isUniqueViolation(driverError('23505'))).toBe(true);
  });

  it('recognises a unique violation wrapped by Drizzle', () => {
    // The regression: the code lives on `cause`, not on the wrapper.
    expect(isUniqueViolation(drizzleQueryError(driverError('23505')))).toBe(true);
  });

  it.each([
    ['another unique violation, foreign key', '23503'],
    ['a syntax error', '42601'],
    ['a serialization failure', '40001'],
  ])('does not recognise %s', (_name, code) => {
    expect(isUniqueViolation(drizzleQueryError(driverError(code)))).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '23505'],
    ['a plain object with no code', { message: 'boom' }],
    ['an object whose code is not a string', { code: 23505 }],
  ])('returns false rather than throwing for %s', (_name, error) => {
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('stops at a self-referencing cause chain', () => {
    // A cycle would otherwise hang the loop forever.
    const looping: { cause?: unknown } = {};
    looping.cause = looping;

    expect(isUniqueViolation(looping)).toBe(false);
  });

  it('finds the code even when wrapped more than once', () => {
    const nested = drizzleQueryError(drizzleQueryError(driverError('23505')));
    expect(isUniqueViolation(nested)).toBe(true);
  });
});
