/**
 * Tests for reading an instant in the clinic's timezone.
 *
 * The browser is deliberately not asked what time it is. A test that passed only
 * because the machine happens to sit on America/Lima would be a test that fails on
 * the next machine and proves nothing on this one, so every assertion here names the
 * zone it is drawing in and passes an explicit locale.
 */

import { describe, expect, it } from 'vitest';

import {
  formatClinicDay,
  formatClinicDayTime,
  formatClinicTime,
  formatClinicTimeRange,
} from './format-clinic-time.js';

const LIMA = 'America/Lima';
const NEW_YORK = 'America/New_York';
const LOCALE = 'en-GB';

/** 14:00Z — which is 09:00 in Lima and 10:00 in New York. */
const MORNING = '2026-10-05T14:00:00.000Z';

describe('formatClinicTime', () => {
  it('draws the instant in the clinic zone, not the visitor one', () => {
    expect(formatClinicTime(MORNING, LIMA, LOCALE)).toBe('09:00');
    expect(formatClinicTime(MORNING, NEW_YORK, LOCALE)).toBe('10:00');
  });

  it('uses a 24-hour clock', () => {
    // 14:00 and 16:00 in the same column, not 2 PM beside 4 PM. A book read aloud
    // all day is the reason.
    expect(formatClinicTime('2026-10-05T14:00:00.000Z', LIMA, LOCALE)).toBe('09:00');
    expect(formatClinicTime('2026-10-05T16:00:00.000Z', LIMA, LOCALE)).toBe('11:00');
  });

  it('says so rather than drawing Invalid Date', () => {
    expect(formatClinicTime('not a date', LIMA, LOCALE)).toBe('—');
  });

  it('does not take the screen down over a zone it cannot resolve', () => {
    // The zone is a row in the database, not a constant. An unknown zone makes
    // `Intl` throw, and inside a render that is a blank page rather than a bad time.
    expect(formatClinicTime(MORNING, 'Mars/Olympus_Mons', LOCALE)).toBe('—');
  });
});

describe('formatClinicDayTime', () => {
  it('names the day the clinic is on', () => {
    // 02:00Z is still the evening of Sunday 4 October in Lima, and already Monday
    // the 5th in New York. The grid is drawn in one of those, not the other.
    expect(formatClinicDayTime('2026-10-05T02:00:00.000Z', LIMA, LOCALE)).toBe('Sun 4 Oct, 21:00');
    expect(formatClinicDayTime('2026-10-05T02:00:00.000Z', NEW_YORK, LOCALE)).toBe(
      'Sun 4 Oct, 22:00',
    );
  });
});

describe('formatClinicDay', () => {
  it('names the day the clinic is on, for the moments it records rather than schedules', () => {
    // 02:00Z on the 5th is still the 4th in Lima: a record created at half past ten at
    // night belongs to the day the receptionist thinks it does.
    expect(formatClinicDay('2026-10-05T02:00:00.000Z', LIMA, LOCALE)).toBe('4 Oct 2026');
    expect(formatClinicDay('2026-10-05T02:00:00.000Z', NEW_YORK, LOCALE)).toBe('4 Oct 2026');
    expect(formatClinicDay('2026-10-05T02:00:00.000Z', 'Pacific/Auckland', LOCALE)).toBe(
      '5 Oct 2026',
    );
  });

  it('says so rather than drawing a day it cannot read', () => {
    expect(formatClinicDay('not a date', LIMA, LOCALE)).toBe('—');
    expect(formatClinicDay(MORNING, 'Mars/Olympus_Mons', LOCALE)).toBe('—');
  });
});

describe('formatClinicTimeRange', () => {
  it('draws both ends in the clinic zone', () => {
    expect(
      formatClinicTimeRange('2026-10-05T14:00:00.000Z', '2026-10-05T15:00:00.000Z', LIMA, LOCALE),
    ).toBe('09:00 – 10:00');
  });

  it('spells out the second end when the booking runs past midnight', () => {
    // 22:00 – 01:00 reads as backwards unless the day is on the right-hand end.
    const range = formatClinicTimeRange(
      '2026-10-05T03:00:00.000Z',
      '2026-10-05T06:00:00.000Z',
      LIMA,
      LOCALE,
    );

    expect(range).toBe('22:00 – Mon 5 Oct, 01:00');
  });

  it('keeps the bare times when the appointment is a moment long', () => {
    expect(
      formatClinicTimeRange('2026-10-05T14:00:00.000Z', '2026-10-05T14:05:00.000Z', LIMA, LOCALE),
    ).toBe('09:00 – 09:05');
  });

  it('says so rather than drawing half a range', () => {
    expect(formatClinicTimeRange('2026-10-05T14:00:00.000Z', 'nope', LIMA, LOCALE)).toBe('—');
  });
});
