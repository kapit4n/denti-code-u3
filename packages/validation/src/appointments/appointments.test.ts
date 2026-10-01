import { describe, expect, it } from 'vitest';
import {
  agendaRangeQuerySchema,
  appointmentSchema,
  createAppointmentSchema,
  transitionAppointmentSchema,
} from './index.js';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const DENTIST_ID = '33333333-3333-4333-8333-333333333333';

describe('appointmentSchema', () => {
  it('accepts an appointment with an explicit UTC instant', () => {
    const result = appointmentSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 45,
      status: 'SCHEDULED',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an instant without an offset', () => {
    const result = appointmentSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00',
      durationMinutes: 45,
      status: 'SCHEDULED',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown status', () => {
    const result = appointmentSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 45,
      status: 'RESCHEDULED',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a duration outside the accepted range', () => {
    const base = {
      id: '44444444-4444-4444-8444-444444444444',
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
      status: 'SCHEDULED',
    };

    expect(appointmentSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(false);
    expect(appointmentSchema.safeParse({ ...base, durationMinutes: 30.5 }).success).toBe(false);
    expect(appointmentSchema.safeParse({ ...base, durationMinutes: 900 }).success).toBe(false);
  });
});

describe('createAppointmentSchema', () => {
  it('requires patient, dentist, start and duration', () => {
    const result = createAppointmentSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('accepts an appointment without a chair', () => {
    const result = createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 30,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a patient id that is not a UUID', () => {
    const result = createAppointmentSchema.safeParse({
      patientId: '42',
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
  });
});

describe('transitionAppointmentSchema', () => {
  it('accepts a target status', () => {
    expect(transitionAppointmentSchema.safeParse({ to: 'ARRIVED' }).success).toBe(true);
  });

  it('rejects a target status outside the domain set', () => {
    expect(transitionAppointmentSchema.safeParse({ to: 'TREATED' }).success).toBe(false);
  });

  it('accepts a cancellation reason', () => {
    expect(
      transitionAppointmentSchema.safeParse({ to: 'CANCELLED', reason: 'Patient is ill' }).success,
    ).toBe(true);
  });
});

describe('agendaRangeQuerySchema', () => {
  it('accepts a half-open range', () => {
    const result = agendaRangeQuerySchema.safeParse({
      from: '2026-09-30T03:00:00.000Z',
      to: '2026-10-01T03:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a calendar date where an instant is expected', () => {
    const result = agendaRangeQuerySchema.safeParse({
      from: '2026-09-30',
      to: '2026-10-01',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed dentist filter list', () => {
    const result = agendaRangeQuerySchema.safeParse({
      from: '2026-09-30T03:00:00.000Z',
      to: '2026-10-01T03:00:00.000Z',
      dentistIds: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });
});
