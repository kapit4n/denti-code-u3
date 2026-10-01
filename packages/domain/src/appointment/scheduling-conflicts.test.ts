import { describe, expect, it } from 'vitest';
import type { Appointment } from './appointment.js';
import { computeAppointmentEnd, isValidAppointmentDuration } from './appointment.js';
import { assertNoSchedulingConflicts, findSchedulingConflicts } from './scheduling-conflicts.js';
import { DomainError } from '../shared/errors.js';
import { asAppointmentId, asChairId, asDentistId, asPatientId } from '@denti-code-u3/types';

const DENTIST_A = asDentistId('11111111-1111-4111-8111-111111111111');
const DENTIST_B = asDentistId('22222222-2222-4222-8222-222222222222');
const CHAIR_1 = asChairId('33333333-3333-4333-8333-333333333333');
const CHAIR_2 = asChairId('44444444-4444-4444-8444-444444444444');
const PATIENT_1 = asPatientId('55555555-5555-4555-8555-555555555555');

/** Deterministic ids keep the domain tests free of any runtime dependency. */
let appointmentSequence = 0;

function nextAppointmentId(): ReturnType<typeof asAppointmentId> {
  appointmentSequence += 1;
  return asAppointmentId(`appointment-${appointmentSequence}`);
}

function appointment(
  overrides: Partial<Appointment> & Pick<Appointment, 'startsAt' | 'durationMinutes'>,
): Appointment {
  return {
    id: nextAppointmentId(),
    clinicId: '66666666-6666-4666-8666-666666666666',
    patientId: PATIENT_1,
    dentistId: DENTIST_A,
    chairId: CHAIR_1,
    status: 'CONFIRMED',
    ...overrides,
  };
}

describe('computeAppointmentEnd', () => {
  it('adds the duration to the start instant without storing a second truth', () => {
    const endsAt = computeAppointmentEnd(
      appointment({ startsAt: '2026-09-30T14:00:00.000Z', durationMinutes: 45 }),
    );

    expect(endsAt).toBe('2026-09-30T14:45:00.000Z');
  });
});

describe('isValidAppointmentDuration', () => {
  it('accepts a typical clinical appointment', () => {
    expect(isValidAppointmentDuration(30)).toBe(true);
    expect(isValidAppointmentDuration(90)).toBe(true);
  });

  it('rejects a non-positive, fractional or absurdly long appointment', () => {
    expect(isValidAppointmentDuration(0)).toBe(false);
    expect(isValidAppointmentDuration(-15)).toBe(false);
    expect(isValidAppointmentDuration(30.5)).toBe(false);
    expect(isValidAppointmentDuration(9 * 60)).toBe(false);
  });
});

describe('findSchedulingConflicts', () => {
  it('finds a conflict when the same dentist is double booked', () => {
    const candidate = appointment({ startsAt: '2026-09-30T14:00:00.000Z', durationMinutes: 60 });
    const existing = [
      appointment({
        startsAt: '2026-09-30T14:30:00.000Z',
        durationMinutes: 30,
        dentistId: DENTIST_A,
        chairId: CHAIR_2,
      }),
    ];

    const conflicts = findSchedulingConflicts(candidate, existing);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.startsAt).toBe('2026-09-30T14:30:00.000Z');
  });

  it('finds a conflict when the same chair is double booked by a different dentist', () => {
    const candidate = appointment({
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 60,
      dentistId: DENTIST_A,
      chairId: CHAIR_1,
    });
    const existing = [
      appointment({
        startsAt: '2026-09-30T14:30:00.000Z',
        durationMinutes: 30,
        dentistId: DENTIST_B,
        chairId: CHAIR_1,
      }),
    ];

    expect(findSchedulingConflicts(candidate, existing)).toHaveLength(1);
  });

  it('allows back-to-back appointments that only touch at the boundary', () => {
    const candidate = appointment({ startsAt: '2026-09-30T15:00:00.000Z', durationMinutes: 30 });
    const existing = [appointment({ startsAt: '2026-09-30T14:00:00.000Z', durationMinutes: 60 })];

    expect(findSchedulingConflicts(candidate, existing)).toEqual([]);
  });

  it('ignores cancelled and no-show appointments, which do not consume chair time', () => {
    const candidate = appointment({ startsAt: '2026-09-30T14:00:00.000Z', durationMinutes: 60 });
    const existing = [
      appointment({
        startsAt: '2026-09-30T14:00:00.000Z',
        durationMinutes: 60,
        status: 'CANCELLED',
      }),
      appointment({
        startsAt: '2026-09-30T14:00:00.000Z',
        durationMinutes: 60,
        status: 'NO_SHOW',
      }),
    ];

    expect(findSchedulingConflicts(candidate, existing)).toEqual([]);
  });

  it('ignores the candidate appointment itself when rescheduling', () => {
    const original = appointment({
      id: asAppointmentId('77777777-7777-4777-8777-777777777777'),
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 60,
    });

    const rescheduled = appointment({
      id: original.id,
      startsAt: '2026-09-30T16:00:00.000Z',
      durationMinutes: 60,
    });

    expect(findSchedulingConflicts(rescheduled, [original])).toEqual([]);
  });

  it('does not conflict with a different dentist in a different chair', () => {
    const candidate = appointment({
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 60,
      dentistId: DENTIST_A,
      chairId: CHAIR_1,
    });
    const existing = [
      appointment({
        startsAt: '2026-09-30T14:00:00.000Z',
        durationMinutes: 60,
        dentistId: DENTIST_B,
        chairId: CHAIR_2,
      }),
    ];

    expect(findSchedulingConflicts(candidate, existing)).toEqual([]);
  });
});

describe('assertNoSchedulingConflicts', () => {
  it('passes when the slot is free', () => {
    const candidate = appointment({ startsAt: '2026-09-30T14:00:00.000Z', durationMinutes: 30 });

    expect(() => assertNoSchedulingConflicts(candidate, [])).not.toThrow();
  });

  it('throws a SCHEDULING_CONFLICT DomainError when the slot is taken', () => {
    const candidate = appointment({ startsAt: '2026-09-30T14:00:00.000Z', durationMinutes: 60 });
    const existing = [appointment({ startsAt: '2026-09-30T14:15:00.000Z', durationMinutes: 45 })];

    expect(() => assertNoSchedulingConflicts(candidate, existing)).toThrow(DomainError);

    try {
      assertNoSchedulingConflicts(candidate, existing);
    } catch (error) {
      expect((error as DomainError).code).toBe('SCHEDULING_CONFLICT');
    }
  });
});
