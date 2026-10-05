/**
 * Tests for the wall clock ⇄ instant conversion.
 *
 * This is the one place the app turns something a person typed into something the API
 * stores, so the cases that matter are the ones where the two could disagree:
 *
 * - **The clinic's zone, not the machine's.** A wall clock means a different instant in
 *   Lima than in New York, and the conversion has to use the one it was given.
 * - **A time the zone never showed.** The daylight-saving gap is the case a naive
 *   conversion silently moves forward, booking a patient for an hour nobody chose.
 * - **An ambiguous hour.** When the clocks go back, an hour happens twice; the earlier
 *   one is chosen and the test says so, because "whichever luxon felt like" is not a
 *   decision a clinic should inherit by accident.
 */

import { describe, expect, it } from 'vitest';

import { instantToZonedWallClock, zonedWallClockToInstant } from './zoned-wall-clock.js';

const LIMA = 'America/Lima';
const NEW_YORK = 'America/New_York';

describe('zonedWallClockToInstant', () => {
  it('reads a wall clock in the clinic zone, not the machine zone', () => {
    // Lima is UTC-5 all year, so 09:00 there is 14:00Z. Reading the same string in
    // this machine's zone would produce a different instant that still looks like a
    // time — the failure the grid's own timezone work exists to prevent.
    expect(zonedWallClockToInstant('2026-10-06T09:00', LIMA)).toBe('2026-10-06T14:00:00.000Z');
  });

  it('reads the same wall clock as a different instant in a different clinic', () => {
    // Same typed value, two clinics, two answers. If this ever came out equal, the
    // zone argument was being ignored somewhere.
    expect(zonedWallClockToInstant('2026-10-06T09:00', NEW_YORK)).toBe('2026-10-06T13:00:00.000Z');
  });

  it('refuses a wall clock that the zone skipped over', () => {
    // 2026-03-08 is a spring-forward Sunday in New York: 02:00 becomes 03:00, so 02:30
    // never arrives. Luxon would quietly answer 03:30, which would book a patient for
    // an hour they did not choose.
    expect(zonedWallClockToInstant('2026-03-08T02:30', NEW_YORK)).toBeUndefined();
  });

  it('takes the first reading of an hour the zone repeated', () => {
    // 2026-11-01 is a fall-back Sunday in New York: 02:00 happens twice. The earlier one
    // is chosen, so the booking is not an hour later than the person asked for.
    expect(zonedWallClockToInstant('2026-11-01T01:30', NEW_YORK)).toBe('2026-11-01T05:30:00.000Z');
  });

  it('accepts the hour either side of the gap', () => {
    // The refusal above is about 02:30, not about the whole day: 01:30 and 03:30 are
    // ordinary hours on the same Sunday and must still book.
    expect(zonedWallClockToInstant('2026-03-08T01:30', NEW_YORK)).toBe('2026-03-08T06:30:00.000Z');
    expect(zonedWallClockToInstant('2026-03-08T03:30', NEW_YORK)).toBe('2026-03-08T07:30:00.000Z');
  });

  it('refuses a date that does not exist at all', () => {
    expect(zonedWallClockToInstant('2026-02-30T09:00', LIMA)).toBeUndefined();
  });

  it('refuses a value that is not a wall clock', () => {
    // The shape is the schema's business; this function answers only "does that clock
    // show this hour", and it says no rather than guessing.
    expect(zonedWallClockToInstant('09:00', LIMA)).toBeUndefined();
    expect(zonedWallClockToInstant('2026-10-06T09:00Z', LIMA)).toBeUndefined();
    expect(zonedWallClockToInstant('', LIMA)).toBeUndefined();
  });

  it('refuses a zone it cannot honour rather than quietly using another one', () => {
    // An unknown zone must not fall back to the machine's: that is how a Lima booking
    // ends up an hour off. The clinic record is validated at its own boundary.
    expect(zonedWallClockToInstant('2026-10-06T09:00', 'Mars/Olympus_Mons')).toBeUndefined();
  });
});

describe('instantToZonedWallClock', () => {
  it('writes back the value the browser reports for an input', () => {
    expect(instantToZonedWallClock('2026-10-06T14:00:00.000Z', LIMA)).toBe('2026-10-06T09:00');
  });

  it('survives a round trip, which is what lets a slot be shown and then reused', () => {
    // The grid hands the dialog an instant, the dialog puts a wall clock in the field,
    // and the submit turns that back into the same instant. Anything lost in the middle
    // is a booking that moved.
    const instant = '2026-10-06T14:00:00.000Z';
    const wallClock = instantToZonedWallClock(instant, LIMA);

    expect(wallClock).toBe('2026-10-06T09:00');
    expect(zonedWallClockToInstant(wallClock ?? '', LIMA)).toBe(instant);
  });

  it('keeps the day the clinic is on, not the day the machine is', () => {
    // 03:00Z is 22:00 on the 6th in Lima and 23:00 on the same day in New York — but
    // 02:00Z is 21:00 on the 6th in Lima and already the 7th in Auckland. The date a
    // receptionist reads off the field has to be the clinic's.
    expect(instantToZonedWallClock('2026-10-06T02:00:00.000Z', 'Pacific/Auckland')).toBe(
      '2026-10-06T15:00',
    );
    expect(instantToZonedWallClock('2026-10-05T23:00:00.000Z', LIMA)).toBe('2026-10-05T18:00');
  });

  it('refuses a value that is not an instant, rather than saying "Invalid DateTime"', () => {
    // The string Luxon formats an invalid date into is not a time. Handing it back
    // would put it in a form, where the only person who can read it is the one who
    // typed it.
    expect(instantToZonedWallClock('tomorrow', LIMA)).toBeUndefined();
    expect(instantToZonedWallClock('', LIMA)).toBeUndefined();
  });
});
