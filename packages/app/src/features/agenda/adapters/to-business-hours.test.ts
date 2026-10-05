/**
 * Tests for the clinic → FullCalendar business-hours translation.
 *
 * The weekday conversion is the whole point of this file, and it is the kind of
 * translation that can be wrong on every single day while still looking right.
 */

import type { Clinic } from '@denti-code-u3/domain';
import { describe, expect, it } from 'vitest';

import { toBusinessHours, toScrollTime } from './to-business-hours.js';

function clinic(operatingHours: Clinic['operatingHours']): Clinic {
  return {
    id: 'clinic-1',
    name: 'Clínica Dental U3',
    legalName: 'Denti-Code U3 S.A.C.',
    timeZone: 'America/Lima',
    currency: 'PEN',
    operatingHours,
    settings: {},
  };
}

const openHours = (weekday: number, opensAt = '09:00', closesAt = '18:00') => ({
  weekday,
  opensAtLocalTime: opensAt,
  closesAtLocalTime: closesAt,
  isClosed: false,
});

describe('toBusinessHours', () => {
  it('puts Monday on column 1 and Sunday on column 0', () => {
    const hours = toBusinessHours(clinic([openHours(1), openHours(7)]));

    // The domain speaks ISO (1 = Monday … 7 = Sunday); FullCalendar speaks
    // `Date.getDay()` (0 = Sunday). Copying the number across would open every clinic
    // one day late and close it one day early.
    expect(hours[0]).toMatchObject({ daysOfWeek: [1], startTime: '09:00', endTime: '18:00' });
    expect(hours[1]).toMatchObject({ daysOfWeek: [0] });
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 0],
  ])('maps ISO weekday %i to JavaScript day %i', (isoWeekday, expected) => {
    expect(toBusinessHours(clinic([openHours(isoWeekday)]))[0]).toMatchObject({
      daysOfWeek: [expected],
    });
  });

  it('skips a closed day instead of drawing it as open', () => {
    const hours = toBusinessHours(clinic([openHours(1), { ...openHours(7), isClosed: true }]));

    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ daysOfWeek: [1] });
  });

  it('draws nothing for a clinic with no opening hours', () => {
    expect(toBusinessHours(clinic([]))).toEqual([]);
  });

  it('never draws hours that would apply to every day of the week', () => {
    // A day with no row is missing, not closed and not open, so the week is simply
    // left unconstrained there. An entry without `daysOfWeek` would be read as
    // "every day", which is a much bigger claim than the record supports.
    const hours = toBusinessHours(clinic([openHours(1, '09:00', '13:00')]));

    expect(hours).toHaveLength(1);
    expect(hours.every((event) => Array.isArray(event.daysOfWeek))).toBe(true);
  });

  it('drops a day it cannot place on a column or parse', () => {
    // Garbage in the opening hours must not become a range on every day of the week.
    const hours = toBusinessHours(
      clinic([
        { ...openHours(1), weekday: 0 },
        { ...openHours(2), opensAtLocalTime: '9' },
        openHours(3),
      ]),
    );

    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ daysOfWeek: [3] });
  });
});

describe('toScrollTime', () => {
  it('scrolls to the earliest opening of the week', () => {
    // A clinic that opens at 14:00 should not have to scroll past seven empty
    // hours to see its first patient.
    expect(toScrollTime(clinic([openHours(2, '13:00'), openHours(1, '08:30')]))).toBe('08:30');
  });

  it('sorts by clock time, not by weekday', () => {
    // '13:00' on Monday is earlier in the day than '09:00' on Tuesday, and a
    // weekday-ordered answer would pick the wrong one.
    expect(toScrollTime(clinic([openHours(1, '13:00'), openHours(2, '09:00')]))).toBe('09:00');
  });

  it('ignores closed and unparseable days', () => {
    expect(
      toScrollTime(clinic([{ ...openHours(1, '07:00'), isClosed: true }, openHours(2, '09:00')])),
    ).toBe('09:00');
    expect(toScrollTime(clinic([{ ...openHours(1), opensAtLocalTime: 'nope' }]))).toBeUndefined();
  });

  it('returns undefined when the clinic has no usable hours', () => {
    // Undefined leaves FullCalendar's own default alone, which is better than a
    // scroll position invented here.
    expect(toScrollTime(clinic([]))).toBeUndefined();
  });
});
