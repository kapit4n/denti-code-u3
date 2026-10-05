/**
 * `isExclusionViolation` reads the Postgres error code off the right object.
 *
 * Worth a unit test on its own, for the reason `isUniqueViolation` has one. The
 * obvious implementation — `(error as { code }).code === '23P01'` — returns
 * `undefined` for every real database error, because Drizzle rethrows driver
 * failures wrapped in its own `DrizzleQueryError` with the original moved to
 * `cause`. A test written against a bare `{ code: '23P01' }` would have passed
 * while every double-booking became a 500, which is the single most likely
 * mistake a receptionist's day will produce.
 *
 * No database needed: the shapes are the only input.
 */

import { describe, expect, it } from 'vitest';

import { isExclusionViolation } from '../src/infrastructure/persistence/repositories/appointment-repository.js';

/** A bare driver error, as `postgres-js` throws it. */
function driverError(code: string): object {
  return { name: 'PostgresError', code, severity: 'ERROR' };
}

/** How Drizzle rethrows it: the driver error moved to `cause`. */
function drizzleQueryError(cause: object): object {
  return { name: 'DrizzleQueryError', message: 'Failed query: insert into "appointments"…', cause };
}

describe('isExclusionViolation', () => {
  it('recognises an exclusion violation thrown directly by the driver', () => {
    expect(isExclusionViolation(driverError('23P01'))).toBe(true);
  });

  it('recognises an exclusion violation wrapped by Drizzle', () => {
    // The regression: the code lives on `cause`, not on the wrapper.
    expect(isExclusionViolation(drizzleQueryError(driverError('23P01')))).toBe(true);
  });

  it.each([
    ['a unique violation', '23505'],
    ['a foreign key violation', '23503'],
    ['a not-null violation', '23502'],
    ['a syntax error', '42601'],
  ])('does not recognise %s', (_name, code) => {
    expect(isExclusionViolation(drizzleQueryError(driverError(code)))).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '23P01'],
    ['a plain object with no code', { message: 'boom' }],
  ])('does not recognise %s', (_name, value) => {
    expect(isExclusionViolation(value)).toBe(false);
  });

  it('gives up on a cause chain that loops, rather than spinning', () => {
    // A self-referential error object is not something the driver produces, but a
    // `while` loop that walks `cause` without a depth limit would hang the process
    // on one, and a scheduling conflict is the wrong moment to find that out.
    const looping: { code?: string; cause?: unknown } = {};
    looping.cause = looping;

    expect(isExclusionViolation(looping)).toBe(false);
  });
});
