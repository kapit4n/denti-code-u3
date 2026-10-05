import { describe, expect, it } from 'vitest';
import type { Appointment } from '../appointment/index.js';
import { DomainError } from '../shared/errors.js';
import type { Visit } from './visit-lifecycle.js';
import {
  acceptsClinicalRecords,
  assertAcceptsClinicalRecords,
  canTransitionVisit,
  completeVisit,
  reopenVisit,
  startVisitFromAppointment,
} from './visit-lifecycle.js';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
} from '@denti-code-u3/types';

const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');

function scheduledAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: asAppointmentId('44444444-4444-4444-8444-444444444444'),
    clinicId: asClinicId('55555555-5555-4555-8555-555555555555'),
    patientId: PATIENT,
    dentistId: DENTIST,
    chairId: asChairId('66666666-6666-4666-8666-666666666666'),
    startsAt: '2026-09-30T14:00:00.000Z',
    durationMinutes: 45,
    status: 'ARRIVED',
    ...overrides,
  };
}

describe('visit state machine', () => {
  it('allows an open visit to be completed or cancelled', () => {
    expect(canTransitionVisit('OPEN', 'COMPLETED')).toBe(true);
    expect(canTransitionVisit('OPEN', 'CANCELLED')).toBe(true);
  });

  it('allows a completed visit to be reopened but not cancelled', () => {
    expect(canTransitionVisit('COMPLETED', 'OPEN')).toBe(true);
    expect(canTransitionVisit('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('treats a cancelled visit as terminal', () => {
    expect(canTransitionVisit('CANCELLED', 'OPEN')).toBe(false);
    expect(canTransitionVisit('CANCELLED', 'COMPLETED')).toBe(false);
  });
});

describe('startVisitFromAppointment', () => {
  it('creates the visit from the appointment and marks the patient as in treatment', () => {
    const appointment = scheduledAppointment();
    const { visit, appointment: updatedAppointment } = startVisitFromAppointment(
      appointment,
      VISIT,
      '2026-09-30T14:05:00.000Z',
    );

    expect(visit).toMatchObject({
      id: VISIT,
      patientId: PATIENT,
      dentistId: DENTIST,
      appointmentId: appointment.id,
      chairId: appointment.chairId,
      status: 'OPEN',
      startedAt: '2026-09-30T14:05:00.000Z',
    });
    expect(updatedAppointment.status).toBe('IN_TREATMENT');
    expect(updatedAppointment.visitId).toBe(VISIT);
  });

  it('never mutates the appointment it was given', () => {
    const appointment = scheduledAppointment();
    startVisitFromAppointment(appointment, VISIT, '2026-09-30T14:05:00.000Z');

    expect(appointment.status).toBe('ARRIVED');
    expect(appointment.visitId).toBeUndefined();
  });

  it('refuses to create a second visit for the same appointment', () => {
    const appointment = scheduledAppointment({ visitId: VISIT });

    expect(() => startVisitFromAppointment(appointment, VISIT, '2026-09-30T14:05:00.000Z')).toThrow(
      DomainError,
    );

    try {
      startVisitFromAppointment(appointment, VISIT, '2026-09-30T14:05:00.000Z');
    } catch (error) {
      expect((error as DomainError).code).toBe('DUPLICATED_RECORD');
    }
  });

  it('refuses to start a visit from a completed appointment', () => {
    const appointment = scheduledAppointment({ status: 'COMPLETED' });

    try {
      startVisitFromAppointment(appointment, VISIT, '2026-09-30T14:05:00.000Z');
      expect.unreachable('a completed appointment must not start a visit');
    } catch (error) {
      expect((error as DomainError).code).toBe('ILLEGAL_TRANSITION');
    }
  });
});

describe('completeVisit', () => {
  const openVisit: Visit = {
    id: VISIT,
    clinicId: asClinicId('55555555-5555-4555-8555-555555555555'),
    patientId: PATIENT,
    dentistId: DENTIST,
    startedAt: '2026-09-30T14:05:00.000Z',
    status: 'OPEN',
  };

  it('closes the visit and records the end instant', () => {
    const completed = completeVisit(openVisit, '2026-09-30T15:00:00.000Z');

    expect(completed.status).toBe('COMPLETED');
    expect(completed.endedAt).toBe('2026-09-30T15:00:00.000Z');
  });

  it('refuses to complete a visit that never started', () => {
    const notStarted: Visit = { ...openVisit, startedAt: undefined };

    try {
      completeVisit(notStarted, '2026-09-30T15:00:00.000Z');
      expect.unreachable('a visit without a start instant must not be completed');
    } catch (error) {
      expect((error as DomainError).code).toBe('INVALID_INPUT');
    }
  });

  it('refuses to complete an already completed visit', () => {
    const completed = completeVisit(openVisit, '2026-09-30T15:00:00.000Z');

    expect(() => completeVisit(completed, '2026-09-30T16:00:00.000Z')).toThrow(DomainError);
  });
});

describe('reopenVisit', () => {
  it('reopens a completed visit for amendment', () => {
    const completed: Visit = {
      id: VISIT,
      clinicId: asClinicId('55555555-5555-4555-8555-555555555555'),
      patientId: PATIENT,
      dentistId: DENTIST,
      startedAt: '2026-09-30T14:05:00.000Z',
      endedAt: '2026-09-30T15:00:00.000Z',
      status: 'COMPLETED',
    };

    const reopened = reopenVisit(completed, '2026-09-30T15:30:00.000Z');

    expect(reopened.status).toBe('OPEN');
    expect(reopened.endedAt).toBeUndefined();
  });
});

describe('acceptsClinicalRecords', () => {
  const base: Visit = {
    id: VISIT,
    clinicId: asClinicId('55555555-5555-4555-8555-555555555555'),
    patientId: PATIENT,
    dentistId: DENTIST,
    startedAt: '2026-09-30T14:05:00.000Z',
    status: 'OPEN',
  };

  it('accepts records only while the visit is open', () => {
    expect(acceptsClinicalRecords(base)).toBe(true);
    expect(acceptsClinicalRecords({ ...base, status: 'COMPLETED' })).toBe(false);
    expect(acceptsClinicalRecords({ ...base, status: 'CANCELLED' })).toBe(false);
  });

  it('throws when a record is added to a closed visit', () => {
    expect(() => assertAcceptsClinicalRecords(base)).not.toThrow();
    expect(() => assertAcceptsClinicalRecords({ ...base, status: 'COMPLETED' })).toThrow(
      DomainError,
    );
  });
});
