import { describe, expect, it } from 'vitest';

import { translate, type TranslationKey, type TranslationParams } from '../../i18n/index.js';
import {
  appointmentCountdownTone,
  describeAppointmentCountdown,
  formatAppointmentCountdown,
} from './appointment-countdown.js';

const NOW = Date.parse('2026-10-05T13:00:00.000Z');

function at(isoDate: string, status = 'SCHEDULED') {
  return { startsAt: isoDate, status };
}

function english(key: TranslationKey, params?: TranslationParams): string {
  return translate('en', key, params);
}

describe('describeAppointmentCountdown', () => {
  it('counts the minutes until a future appointment', () => {
    expect(describeAppointmentCountdown(at('2026-10-05T13:03:00.000Z'), NOW)).toEqual({
      kind: 'upcoming',
      totalMinutes: 3,
      hours: 0,
      minutes: 3,
    });
  });

  it('rounds a partial minute up, so it never claims zero minutes remain', () => {
    expect(describeAppointmentCountdown(at('2026-10-05T13:00:45.000Z'), NOW)).toMatchObject({
      kind: 'upcoming',
      totalMinutes: 1,
    });
  });

  it('names whole hours and their remainder', () => {
    expect(describeAppointmentCountdown(at('2026-10-05T14:00:00.000Z'), NOW)).toMatchObject({
      kind: 'upcoming',
      hours: 1,
      minutes: 0,
      totalMinutes: 60,
    });
    expect(describeAppointmentCountdown(at('2026-10-05T14:05:00.000Z'), NOW)).toMatchObject({
      kind: 'upcoming',
      hours: 1,
      minutes: 5,
    });
  });

  it('calls the first minute after the start "now"', () => {
    expect(describeAppointmentCountdown(at('2026-10-05T13:00:00.000Z'), NOW)).toEqual({
      kind: 'now',
    });
    expect(describeAppointmentCountdown(at('2026-10-05T12:59:01.000Z'), NOW)).toEqual({
      kind: 'now',
    });
  });

  it('names whole minutes of lateness only after the first minute', () => {
    expect(describeAppointmentCountdown(at('2026-10-05T12:59:00.000Z'), NOW)).toMatchObject({
      kind: 'late',
      totalMinutes: 1,
    });
    expect(describeAppointmentCountdown(at('2026-10-05T12:48:30.000Z'), NOW)).toMatchObject({
      kind: 'late',
      totalMinutes: 11,
      hours: 0,
      minutes: 11,
    });
    expect(describeAppointmentCountdown(at('2026-10-05T11:55:00.000Z'), NOW)).toMatchObject({
      kind: 'late',
      totalMinutes: 65,
      hours: 1,
      minutes: 5,
    });
  });

  it('does not count down an appointment that is no longer waiting to start', () => {
    expect(describeAppointmentCountdown(at('2026-10-05T14:00:00.000Z', 'ARRIVED'), NOW)).toBeNull();
    expect(
      describeAppointmentCountdown(at('2026-10-05T14:00:00.000Z', 'IN_TREATMENT'), NOW),
    ).toBeNull();
    expect(
      describeAppointmentCountdown(at('2026-10-05T14:00:00.000Z', 'CANCELLED'), NOW),
    ).toBeNull();
    expect(
      describeAppointmentCountdown(at('2026-10-05T14:00:00.000Z', 'COMPLETED'), NOW),
    ).toBeNull();
  });

  it('draws nothing for a start that is not an instant', () => {
    expect(describeAppointmentCountdown(at('not a date'), NOW)).toBeNull();
  });
});

describe('appointmentCountdownTone', () => {
  it('warns near the start, stays neutral farther out, and turns danger when late', () => {
    expect(
      appointmentCountdownTone({
        kind: 'upcoming',
        totalMinutes: 16,
        hours: 0,
        minutes: 16,
      }),
    ).toBe('neutral');
    expect(
      appointmentCountdownTone({
        kind: 'upcoming',
        totalMinutes: 15,
        hours: 0,
        minutes: 15,
      }),
    ).toBe('warning');
    expect(appointmentCountdownTone({ kind: 'now' })).toBe('warning');
    expect(
      appointmentCountdownTone({
        kind: 'late',
        totalMinutes: 1,
        hours: 0,
        minutes: 1,
      }),
    ).toBe('danger');
  });
});

describe('formatAppointmentCountdown', () => {
  it('writes minutes, hours and the mixed form', () => {
    expect(
      formatAppointmentCountdown(english, {
        kind: 'upcoming',
        totalMinutes: 3,
        hours: 0,
        minutes: 3,
      }),
    ).toBe('in 3 min');
    expect(
      formatAppointmentCountdown(english, {
        kind: 'upcoming',
        totalMinutes: 60,
        hours: 1,
        minutes: 0,
      }),
    ).toBe('in 1 h');
    expect(
      formatAppointmentCountdown(english, {
        kind: 'upcoming',
        totalMinutes: 65,
        hours: 1,
        minutes: 5,
      }),
    ).toBe('in 1 h 5 min');
  });

  it('writes now and late without inventing a countdown', () => {
    expect(formatAppointmentCountdown(english, { kind: 'now' })).toBe('now');
    expect(
      formatAppointmentCountdown(english, {
        kind: 'late',
        totalMinutes: 12,
        hours: 0,
        minutes: 12,
      }),
    ).toBe('late 12 min');
    expect(
      formatAppointmentCountdown(english, {
        kind: 'late',
        totalMinutes: 65,
        hours: 1,
        minutes: 5,
      }),
    ).toBe('late 1 h 5 min');
  });
});
