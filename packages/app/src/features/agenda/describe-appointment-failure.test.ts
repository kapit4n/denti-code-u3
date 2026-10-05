/**
 * Tests for the sentences a refused schedule write produces.
 *
 * Every case here is a moment where the user has just been told "no" and has to
 * decide what to do next. The assertions are about the words — a message that names
 * the hour is actionable, one that names a log line is not — and about the timezone
 * those hours are quoted in, which is the mistake that makes them point at the wrong
 * part of the day.
 */

import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@denti-code-u3/api-client';

import { describeAppointmentFailure } from './describe-appointment-failure.js';

const LIMA = 'America/Lima';

const CONTEXT = { timeZone: LIMA, fallback: 'The appointment could not be saved.' };

const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const DENTIST_ID = '33333333-3333-4333-8333-333333333333';

function conflict(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: '44444444-4444-4444-8444-444444444444',
    patientId: PATIENT_ID,
    dentistId: DENTIST_ID,
    startsAt: '2026-10-05T14:00:00.000Z',
    endsAt: '2026-10-05T15:00:00.000Z',
    ...overrides,
  };
}

function conflictError(
  conflicts: unknown[],
  message = 'The appointment overlaps 1 appointment(s)',
) {
  return new ApiClientError('SCHEDULING_CONFLICT', message, 409, { conflicts });
}

describe('describeAppointmentFailure', () => {
  it('says nothing when nothing failed', () => {
    expect(describeAppointmentFailure(undefined, CONTEXT)).toBeUndefined();
    expect(describeAppointmentFailure(null, CONTEXT)).toBeUndefined();
  });

  it('names the hour the clash is at, in the clinic timezone', () => {
    // 14:00Z is 09:00 in Lima. Quoting 14:00 here would send the receptionist to an
    // hour the clinic is not even open, which is the whole cost of getting this wrong.
    const message = describeAppointmentFailure(conflictError([conflict()]), CONTEXT);

    expect(message).toBe(
      'That time overlaps an appointment already booked, 09:00 – 10:00. Move it, or pick another slot.',
    );
  });

  it('does not quote the visitor timezone', () => {
    const message = describeAppointmentFailure(conflictError([conflict()]), {
      timeZone: 'America/New_York',
      fallback: 'unused',
    });

    expect(message).toContain('10:00 – 11:00');
  });

  it('lists every clash when the move hit more than one', () => {
    const message = describeAppointmentFailure(
      conflictError([
        conflict(),
        conflict({ startsAt: '2026-10-05T16:00:00.000Z', endsAt: '2026-10-05T17:00:00.000Z' }),
      ]),
      CONTEXT,
    );

    expect(message).toBe(
      'That time overlaps 2 appointments already booked: 09:00 – 10:00, 11:00 – 12:00. Move one of them, or pick another slot.',
    );
  });

  it('still says something when the envelope carries no readable conflicts', () => {
    // A proxy that rewrote the body, or an API that grew the details into something
    // else. The sentence keeps its meaning and loses the time: a wrong hour is worse
    // than no hour.
    expect(
      describeAppointmentFailure(
        new ApiClientError('SCHEDULING_CONFLICT', 'refused', 409, { conflicts: 'soon' }),
        CONTEXT,
      ),
    ).toBe('That time is already booked for this dentist or chair.');

    expect(
      describeAppointmentFailure(new ApiClientError('SCHEDULING_CONFLICT', '', 409), CONTEXT),
    ).toBe('That time is already booked for this dentist or chair.');
  });

  it('passes on the domain sentence for opening hours', () => {
    // The domain knows the clinic's own hours and phrases them in the clinic's terms.
    // Rewriting that here would be a second phrasing to keep in step with the first.
    const error = new ApiClientError(
      'VALIDATION_ERROR',
      'The clinic opens at 08:00 on 2026-10-11',
      422,
    );

    expect(describeAppointmentFailure(error, CONTEXT)).toBe(
      'The clinic opens at 08:00 on 2026-10-11',
    );
  });

  it('passes on the domain sentence for an appointment that can no longer be moved', () => {
    const error = new ApiClientError(
      'DOMAIN_RULE_VIOLATION',
      'A COMPLETED appointment can no longer be rescheduled',
      409,
    );

    expect(describeAppointmentFailure(error, CONTEXT)).toBe(
      'A COMPLETED appointment can no longer be rescheduled',
    );
  });

  it('does not repeat a cancellation that needs a reason', () => {
    const error = new ApiClientError('VALIDATION_ERROR', 'A cancellation must say why', 422);

    expect(describeAppointmentFailure(error, CONTEXT)).toBe('A cancellation must say why');
  });

  it('says the appointment is gone rather than asking for a retry', () => {
    const error = new ApiClientError('NOT_FOUND', 'Appointment not found', 404);

    expect(describeAppointmentFailure(error, CONTEXT)).toBe('That appointment no longer exists.');
  });

  it('distinguishes a dead connection from a refusal', () => {
    const error = new ApiClientError('NETWORK_ERROR', '', 0);

    expect(describeAppointmentFailure(error, CONTEXT)).toBe(
      'Could not reach the server. Check the connection and try again.',
    );
  });

  it('falls back rather than rendering an empty alert', () => {
    // An empty message is what an unhandled fault or a proxy arrives with. An alert
    // with no text in it reads as "no error" while the write has quietly failed.
    const error = new ApiClientError('INTERNAL_ERROR', '', 500);

    expect(describeAppointmentFailure(error, CONTEXT)).toBe('The appointment could not be saved.');
  });

  it('shows a message for a code this build has never seen', () => {
    const error = new ApiClientError('INTERNAL_ERROR', 'The compressor is offline', 503);

    expect(describeAppointmentFailure(error, CONTEXT)).toBe('The compressor is offline');
  });
});
