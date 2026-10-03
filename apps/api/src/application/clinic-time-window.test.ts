/**
 * The window maths is the part of the dashboard that fails silently, so it is
 * tested against real offsets rather than a mocked `Intl`.
 */

import { describe, expect, it } from 'vitest';

import { minutesBookedWithin, resolveClinicTimeWindow } from './clinic-time-window.js';

/** Renders an instant in the zone the same way a client would. */
function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(instant);
}

describe('resolveClinicTimeWindow', () => {
  it('anchors "today" to clinic-local midnight for a negative-offset clinic', () => {
    // 2026-03-10T03:00Z is 2026-03-09 21:00 in Guatemala (UTC-6): still the 9th.
    const window = resolveClinicTimeWindow(
      new Date('2026-03-10T03:00:00.000Z'),
      'America/Guatemala',
    );

    expect(window.start.toISOString()).toBe('2026-03-09T06:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-03-10T06:00:00.000Z');
    expect(localTime(window.start, 'America/Guatemala')).toBe('2026-03-09, 00:00:00');
  });

  it('keeps the clinic on its own day while UTC has already rolled over', () => {
    // 2026-03-10T02:00Z is 2026-03-09 20:00 in Guatemala; the next hour crosses
    // UTC midnight. The window must not move.
    const before = resolveClinicTimeWindow(
      new Date('2026-03-10T02:00:00.000Z'),
      'America/Guatemala',
    );
    const after = resolveClinicTimeWindow(
      new Date('2026-03-10T03:00:00.000Z'),
      'America/Guatemala',
    );

    expect(before.start.toISOString()).toBe(after.start.toISOString());
  });

  it('uses UTC midnight when the clinic is on UTC', () => {
    const window = resolveClinicTimeWindow(new Date('2026-06-15T10:30:00.000Z'), 'UTC');

    expect(window.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });

  it('handles a positive-offset clinic', () => {
    // 2026-06-15T22:00Z is already 2026-06-16 07:00 in Tokyo (UTC+9).
    const window = resolveClinicTimeWindow(new Date('2026-06-15T22:00:00.000Z'), 'Asia/Tokyo');

    expect(window.start.toISOString()).toBe('2026-06-15T15:00:00.000Z');
    expect(localTime(window.start, 'Asia/Tokyo')).toBe('2026-06-16, 00:00:00');
  });

  it('reports the clinic-local weekday, not the UTC one', () => {
    // 2026-03-10T03:00Z: a Tuesday in UTC, a Monday in Guatemala.
    expect(resolveClinicTimeWindow(new Date('2026-03-10T03:00:00.000Z'), 'UTC').dayOfWeek).toBe(2);
    expect(
      resolveClinicTimeWindow(new Date('2026-03-10T03:00:00.000Z'), 'America/Guatemala').dayOfWeek,
    ).toBe(1);
  });

  it('brackets a month at clinic-local midnight', () => {
    const window = resolveClinicTimeWindow(
      new Date('2026-06-15T18:00:00.000Z'),
      'America/Guatemala',
    );

    expect(localTime(window.startOfMonth, 'America/Guatemala')).toBe('2026-06-01, 00:00:00');
    expect(localTime(window.startOfNextMonth, 'America/Guatemala')).toBe('2026-07-01, 00:00:00');
  });

  it('rolls the month over in December', () => {
    const window = resolveClinicTimeWindow(
      new Date('2026-12-20T15:00:00.000Z'),
      'America/Guatemala',
    );

    expect(localTime(window.startOfNextMonth, 'America/Guatemala')).toBe('2027-01-01, 00:00:00');
  });

  it('survives a daylight-saving transition', () => {
    // Guatemala has no DST, so use a zone that does. US DST began 2026-03-08.
    const window = resolveClinicTimeWindow(
      new Date('2026-03-09T18:00:00.000Z'),
      'America/New_York',
    );

    // EDT is UTC-4 after the transition; local midnight is 04:00Z.
    expect(window.start.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // The following day is still EDT, so the window is a full 24 hours.
    expect(window.end.getTime() - window.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('produces a 23-hour day when DST starts inside the window', () => {
    // US DST began 2026-03-08, so the local day 2026-03-08 is only 23 hours long.
    const window = resolveClinicTimeWindow(
      new Date('2026-03-08T18:00:00.000Z'),
      'America/New_York',
    );

    expect(localTime(window.start, 'America/New_York')).toBe('2026-03-08, 00:00:00');
    expect(window.end.getTime() - window.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

describe('minutesBookedWithin', () => {
  const window = {
    start: new Date('2026-03-12T00:00:00.000Z'),
    end: new Date('2026-03-13T00:00:00.000Z'),
  };
  const entry = (startsAt: string, endsAt: string, status = 'SCHEDULED') => ({
    startsAt,
    endsAt,
    status,
  });

  it('counts an appointment that lies entirely inside the day', () => {
    const minutes = minutesBookedWithin(
      [entry('2026-03-12T09:00:00.000Z', '2026-03-12T09:30:00.000Z')],
      window,
    );

    expect(minutes).toBe(30);
  });

  it('counts only the part of an appointment that began the evening before', () => {
    // The appointment belongs to today's agenda — the chair is occupied at 00:00 —
    // but only 30 of its 120 minutes are today's work. Counting the whole 120
    // would charge yesterday's surgery against today's capacity and could push the
    // occupancy rate over 100% on a day that is only half booked.
    const minutes = minutesBookedWithin(
      [entry('2026-03-11T22:30:00.000Z', '2026-03-12T00:30:00.000Z')],
      window,
    );

    expect(minutes).toBe(30);
  });

  it('counts only the part of an appointment that runs into the next day', () => {
    const minutes = minutesBookedWithin(
      [entry('2026-03-12T23:30:00.000Z', '2026-03-13T01:00:00.000Z')],
      window,
    );

    expect(minutes).toBe(30);
  });

  it('counts nothing for an appointment outside the window', () => {
    const minutes = minutesBookedWithin(
      [
        entry('2026-03-10T09:00:00.000Z', '2026-03-10T10:00:00.000Z'),
        entry('2026-03-14T09:00:00.000Z', '2026-03-14T10:00:00.000Z'),
      ],
      window,
    );

    expect(minutes).toBe(0);
  });

  it('does not count cancelled or no-show appointments', () => {
    const minutes = minutesBookedWithin(
      [
        entry('2026-03-12T09:00:00.000Z', '2026-03-12T10:00:00.000Z', 'CANCELLED'),
        entry('2026-03-12T11:00:00.000Z', '2026-03-12T12:00:00.000Z', 'NO_SHOW'),
        entry('2026-03-12T13:00:00.000Z', '2026-03-12T14:00:00.000Z', 'COMPLETED'),
      ],
      window,
    );

    // Cancelled and no-show release their slot; completed work is reported on its
    // own and is not capacity the clinic still has to sell today.
    expect(minutes).toBe(0);
  });

  it('sums several appointments, including one crossing the boundary', () => {
    const minutes = minutesBookedWithin(
      [
        entry('2026-03-12T09:00:00.000Z', '2026-03-12T09:30:00.000Z'),
        entry('2026-03-11T23:45:00.000Z', '2026-03-12T00:15:00.000Z', 'IN_TREATMENT'),
        entry('2026-03-12T14:00:00.000Z', '2026-03-12T14:45:00.000Z', 'CONFIRMED'),
      ],
      window,
    );

    expect(minutes).toBe(30 + 15 + 45);
  });

  it('counts nothing when the day has no appointments', () => {
    expect(minutesBookedWithin([], window)).toBe(0);
  });
});
