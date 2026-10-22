import { describe, expect, it } from 'vitest';

import { capacityMinutesForDays, occupancyRate } from './report-capacity.js';

const monday = { date: '2026-10-05', dayOfWeek: 1 };
const tuesday = { date: '2026-10-06', dayOfWeek: 2 };
const sunday = { date: '2026-10-11', dayOfWeek: 0 };

const week = [
  { dayOfWeek: 0, opensAt: null, closesAt: null, breakStartsAt: null, breakEndsAt: null },
  {
    dayOfWeek: 1,
    opensAt: '08:00',
    closesAt: '17:00',
    breakStartsAt: '12:00',
    breakEndsAt: '13:00',
  },
  {
    dayOfWeek: 2,
    opensAt: '08:00',
    closesAt: '12:00',
    breakStartsAt: null,
    breakEndsAt: null,
  },
];

describe('capacityMinutesForDays', () => {
  it('adds each day’s open minutes, less the break, once per clinician', () => {
    // Monday is 9 hours less a 1-hour break = 480. Tuesday is 4 hours = 240.
    expect(capacityMinutesForDays([monday, tuesday], week, 1)).toBe(720);
    expect(capacityMinutesForDays([monday, tuesday], week, 2)).toBe(1_440);
  });

  it('counts a closed day as zero capacity rather than missing data', () => {
    expect(capacityMinutesForDays([sunday, monday], week, 1)).toBe(480);
  });

  it('returns null when the clinic has no hours, no clinicians or no days', () => {
    expect(capacityMinutesForDays([monday], [], 1)).toBeNull();
    expect(capacityMinutesForDays([monday], week, 0)).toBeNull();
    expect(capacityMinutesForDays([], week, 1)).toBeNull();
  });

  it('returns null when every day in the period is closed', () => {
    // A Sunday-only report from a Monday-to-Friday clinic has no denominator, and
    // 0% would claim it had one.
    expect(capacityMinutesForDays([sunday], week, 1)).toBeNull();
  });
});

describe('occupancyRate', () => {
  it('rounds the booked share of capacity', () => {
    expect(occupancyRate(60, 540)).toBe(11);
    expect(occupancyRate(540, 540)).toBe(100);
  });

  it('keeps unknown capacity unknown', () => {
    expect(occupancyRate(0, null)).toBeNull();
    expect(occupancyRate(0, 0)).toBeNull();
  });
});
