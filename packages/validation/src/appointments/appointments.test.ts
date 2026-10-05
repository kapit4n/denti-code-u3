import { describe, expect, it } from 'vitest';
import {
  agendaRangeQuerySchema,
  appointmentStatusSchema,
  createAppointmentFormSchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  scheduleConflictDetailsSchema,
  transitionAppointmentSchema,
} from './index.js';

const PATIENT_ID = '22222222-2222-4222-8222-222222222222';
const DENTIST_ID = '33333333-3333-4333-8333-333333333333';

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

  it('does not carry a room or a treatment through to the row', () => {
    const result = createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      roomId: '44444444-4444-4444-8444-444444444444',
      treatmentId: '55555555-5555-4555-8555-555555555555',
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 30,
    });

    // Both are dropped rather than rejected, so a client that sends them is not
    // broken by the choice. What matters is that neither reaches the insert: the
    // read model cannot report a room, and there is no treatment_id column (ADR
    // 0018). A test asserting rejection here would only be asserting Zod's
    // default, so it asserts the consequence instead.
    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty('roomId');
    expect(result.success && result.data).not.toHaveProperty('treatmentId');
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

  it('requires a dentist, because a booking nobody will perform is not a booking', () => {
    const result = createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a start without an offset', () => {
    // A local date-time is ambiguous twice a year, and the agenda is stored in UTC.
    const result = createAppointmentSchema.safeParse({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00',
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a duration outside the accepted range', () => {
    const base = {
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: '2026-09-30T14:00:00.000Z',
    };

    expect(createAppointmentSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...base, durationMinutes: 30.5 }).success).toBe(
      false,
    );
    expect(createAppointmentSchema.safeParse({ ...base, durationMinutes: 900 }).success).toBe(
      false,
    );
  });
});

describe('appointmentStatusSchema', () => {
  it('accepts every status the domain declares', () => {
    expect(appointmentStatusSchema.safeParse('IN_TREATMENT').success).toBe(true);
  });

  it('rejects a status the domain does not declare', () => {
    // The API has a startup check that this list and the domain's match, so a
    // status invented here cannot reach production quietly.
    expect(appointmentStatusSchema.safeParse('RESCHEDULED').success).toBe(false);
  });
});

describe('rescheduleAppointmentSchema', () => {
  it('accepts a move of the time alone', () => {
    const result = rescheduleAppointmentSchema.safeParse({ startsAt: '2026-09-30T15:00:00.000Z' });

    expect(result.success).toBe(true);
  });

  it('accepts a change of dentist and chair', () => {
    const result = rescheduleAppointmentSchema.safeParse({
      startsAt: '2026-09-30T15:00:00.000Z',
      dentistId: DENTIST_ID,
      chairId: '44444444-4444-4444-8444-444444444444',
    });

    expect(result.success).toBe(true);
  });

  it('requires a start, because a reschedule with no time moves nothing', () => {
    expect(rescheduleAppointmentSchema.safeParse({ durationMinutes: 45 }).success).toBe(false);
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

  it('reads an empty filter list as no filter at all', () => {
    // `?dentistIds=` is what a cleared selection looks like if a client sends the
    // empty string rather than omitting the parameter. Two things have to hold for
    // that to be harmless, and only the second was covered:
    //
    // - the blank is dropped here, so `''` does not reach `uuidSchema` and 422 the
    //   whole request — an unfiltered day reported as a server error;
    // - the repository then skips a zero-length filter, which
    //   `agenda.integration.test.ts` asserts against real rows.
    //
    // Pinned separately because the failure is invisible: the client omits the
    // parameter entirely, so nothing in the app ever sends `?dentistIds=` today and
    // this branch would only be reached by the next client that does.
    const result = agendaRangeQuerySchema.safeParse({
      from: '2026-09-30T03:00:00.000Z',
      to: '2026-10-01T03:00:00.000Z',
      dentistIds: '',
    });

    expect(result.success).toBe(true);
    expect(result.data?.dentistIds).toEqual([]);
  });

  it('drops blanks between real ids rather than rejecting the list', () => {
    const result = agendaRangeQuerySchema.safeParse({
      from: '2026-09-30T03:00:00.000Z',
      to: '2026-10-01T03:00:00.000Z',
      dentistIds: '44444444-4444-4444-8444-444444444444,,55555555-5555-4555-8555-555555555555',
    });

    // The alternative is a 422 for a list a human could type, which is the wrong
    // lesson: it reads as "this endpoint rejects two clinicians", not "that comma
    // was a typo".
    expect(result.success).toBe(true);
    expect(result.data?.dentistIds).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ]);
  });
});

describe('scheduleConflictDetailsSchema', () => {
  const conflict = {
    appointmentId: '44444444-4444-4444-8444-444444444444',
    patientId: PATIENT_ID,
    dentistId: DENTIST_ID,
    startsAt: '2026-09-30T14:00:00.000Z',
    endsAt: '2026-09-30T15:00:00.000Z',
  };

  it('reads the details of a refusal the way the domain writes them', () => {
    // The shape this has to survive is the domain's `ScheduleConflict`: an id set, a
    // chair only when there is one, and a dentist that goes null when that dentist
    // leaves the clinic.
    const result = scheduleConflictDetailsSchema.safeParse({
      conflicts: [
        conflict,
        { ...conflict, chairId: '55555555-5555-4555-8555-555555555555' },
        { ...conflict, dentistId: null },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('refuses details it would have to guess at', () => {
    // A client that cannot read the conflicts must fall back to a sentence without
    // times, so a malformed payload has to fail rather than half-parse.
    const result = scheduleConflictDetailsSchema.safeParse({
      conflicts: [{ ...conflict, startsAt: 'yesterday' }],
    });

    expect(result.success).toBe(false);
  });

  it('refuses an envelope with no conflict list', () => {
    expect(scheduleConflictDetailsSchema.safeParse({}).success).toBe(false);
  });
});

describe('createAppointmentFormSchema', () => {
  const complete = {
    patientId: PATIENT_ID,
    dentistId: DENTIST_ID,
    chairId: '55555555-5555-4555-8555-555555555555',
    localStartsAt: '2026-09-30T09:00',
    durationMinutes: 30,
    notes: 'First visit',
  };

  it('holds a field for every one the API accepts except the instant, which is derived', () => {
    // The patient schemas make the same assertion for the same reason: a form field
    // with no counterpart in the request schema is a field whose only symptom is a
    // 422 the user cannot act on.
    //
    // The one field that is not shared is the time, and deliberately so: the form
    // holds the clinic's wall clock and the app turns it into an instant. Checking
    // the rest by name is what keeps this honest — a new form field with no request
    // counterpart fails here instead of on the wire.
    expect(Object.keys(createAppointmentFormSchema.shape).sort()).toEqual([
      'chairId',
      'dentistId',
      'durationMinutes',
      'localStartsAt',
      'notes',
      'patientId',
    ]);

    for (const field of Object.keys(createAppointmentFormSchema.shape)) {
      if (field === 'localStartsAt') continue;
      expect(createAppointmentSchema.shape).toHaveProperty(field);
    }
  });

  it('reads an empty chair and an empty note as absent, because a form submits them', () => {
    // Without this, booking without a chair is impossible: the API's `optional`
    // accepts `undefined` and refuses `''`.
    const result = createAppointmentFormSchema.parse({
      ...complete,
      chairId: '',
      notes: '',
    });

    expect(result.chairId).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });

  it('reads whitespace as absent too, since that is what an untouched box holds', () => {
    const result = createAppointmentFormSchema.parse({ ...complete, notes: '   ' });

    expect(result.notes).toBeUndefined();
  });

  it('keeps a chair and a note the user did fill in', () => {
    const result = createAppointmentFormSchema.parse(complete);

    expect(result.chairId).toBe(complete.chairId);
    expect(result.notes).toBe('First visit');
  });

  it('says what to do about the two required pickers, because "Invalid uuid" is not actionable', () => {
    const result = createAppointmentFormSchema.safeParse({
      ...complete,
      patientId: '',
      dentistId: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages).toContain('Choose a patient');
    expect(messages).toContain('Choose a clinician');
  });

  it('asks for a wall clock, and says what to do instead of parsing jargon', () => {
    // `Invalid datetime` is not something a receptionist can act on, and the field is
    // a choice. Same reasoning as the two pickers above.
    const result = createAppointmentFormSchema.safeParse({ ...complete, localStartsAt: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toContain('Choose a date and time');
  });

  it('refuses an instant where a wall clock belongs', () => {
    // The whole point of the field: a value carrying an offset has already made the
    // zone decision that belongs to the clinic, so accepting it would let a caller
    // book 09:00 in the machine's zone and call it the clinic's.
    const result = createAppointmentFormSchema.safeParse({
      ...complete,
      localStartsAt: '2026-09-30T14:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('refuses a wall clock that reads like a date but is not one', () => {
    // `datetime-local` cannot produce this, but the value comes over a wire from
    // wherever the form lives, and 2026-02-30 is what a mistyped month produces.
    const result = createAppointmentFormSchema.safeParse({
      ...complete,
      localStartsAt: '2026-02-30T09:00',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toContain('That date does not exist');
  });

  it('refuses a duration the API would refuse', () => {
    const result = createAppointmentFormSchema.safeParse({ ...complete, durationMinutes: 1 });

    expect(result.success).toBe(false);
  });
});
