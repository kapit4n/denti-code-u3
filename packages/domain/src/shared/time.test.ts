import { describe, expect, it } from 'vitest';
import { clinicDayBounds, intervalsOverlap, isWithinRange } from './time.js';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const MADRID = 'Europe/Madrid';
const TOKYO = 'Asia/Tokyo';
const UTC = 'UTC';

describe('clinicDayBounds', () => {
  it('returns a UTC-midnight day for a UTC clinic', () => {
    const bounds = clinicDayBounds('2026-09-30', UTC);

    expect(bounds.startsAt).toBe('2026-09-30T00:00:00.000Z');
    expect(bounds.endsAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('shifts local midnight to the correct UTC instant in a negative-offset zone', () => {
    const bounds = clinicDayBounds('2026-09-30', BUENOS_AIRES);

    // Buenos Aires is UTC-3 year round.
    expect(bounds.startsAt).toBe('2026-09-30T03:00:00.000Z');
  });

  it('shifts local midnight in a positive-offset zone', () => {
    const bounds = clinicDayBounds('2026-09-30', TOKYO);

    // Tokyo is UTC+9 year round.
    expect(bounds.startsAt).toBe('2026-09-29T15:00:00.000Z');
  });

  it('resolves the offset across a daylight-saving transition', () => {
    // Spain moves to CEST on 2026-03-29 (UTC+2) after being UTC+1.
    const beforeTransition = clinicDayBounds('2026-03-28', MADRID);
    const afterTransition = clinicDayBounds('2026-03-30', MADRID);

    expect(beforeTransition.startsAt).toBe('2026-03-27T23:00:00.000Z');
    expect(afterTransition.startsAt).toBe('2026-03-29T22:00:00.000Z');
  });

  it('always produces a 24-hour interval', () => {
    const bounds = clinicDayBounds('2026-03-29', MADRID);

    expect(new Date(bounds.endsAt).getTime() - new Date(bounds.startsAt).getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it('rejects a malformed calendar date', () => {
    expect(() => clinicDayBounds('30/09/2026', UTC)).toThrow(RangeError);
    expect(() => clinicDayBounds('', UTC)).toThrow(RangeError);
  });
});

describe('isWithinRange', () => {
  const startsAt = '2026-09-30T03:00:00.000Z';
  const endsAt = '2026-10-01T03:00:00.000Z';

  it('includes the first instant and excludes the end instant', () => {
    expect(isWithinRange(startsAt, startsAt, endsAt)).toBe(true);
    expect(isWithinRange(endsAt, startsAt, endsAt)).toBe(false);
  });

  it('excludes an instant before the range', () => {
    expect(isWithinRange('2026-09-30T02:59:59.999Z', startsAt, endsAt)).toBe(false);
  });
});

describe('intervalsOverlap', () => {
  const at = (time: string): string => `2026-09-30T${time}:00.000Z`;

  it('detects a partial overlap in both directions', () => {
    expect(intervalsOverlap(at('10:00'), at('11:00'), at('10:30'), at('11:30'))).toBe(true);
    expect(intervalsOverlap(at('10:30'), at('11:30'), at('10:00'), at('11:00'))).toBe(true);
  });

  it('treats touching intervals as non-overlapping', () => {
    expect(intervalsOverlap(at('10:00'), at('11:00'), at('11:00'), at('12:00'))).toBe(false);
    expect(intervalsOverlap(at('11:00'), at('12:00'), at('10:00'), at('11:00'))).toBe(false);
  });

  it('detects a fully contained interval', () => {
    expect(intervalsOverlap(at('10:00'), at('12:00'), at('10:30'), at('11:00'))).toBe(true);
  });

  it('detects a fully containing interval', () => {
    expect(intervalsOverlap(at('10:30'), at('11:00'), at('10:00'), at('12:00'))).toBe(true);
  });

  it('reports two disjoint appointments as free', () => {
    expect(intervalsOverlap(at('08:00'), at('09:00'), at('14:00'), at('15:00'))).toBe(false);
  });
});
