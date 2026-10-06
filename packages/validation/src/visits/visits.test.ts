import { describe, expect, it } from 'vitest';
import { startVisitSchema, startWalkInVisitSchema } from './index.js';

const APPOINTMENT_ID = '44444444-4444-4444-8444-444444444444';
const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const DENTIST_ID = '33333333-3333-4333-8333-333333333333';
const CHAIR_ID = '77777777-7777-4777-8777-777777777777';

describe('startVisitSchema', () => {
  it('accepts an appointment id and nothing else', () => {
    const result = startVisitSchema.safeParse({ appointmentId: APPOINTMENT_ID });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ appointmentId: APPOINTMENT_ID });
  });

  it('refuses an empty body', () => {
    expect(startVisitSchema.safeParse({}).success).toBe(false);
  });

  it('refuses a missing appointment id rather than defaulting to a null booking', () => {
    const result = startVisitSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['appointmentId']);
  });

  it('refuses an id that is not a uuid', () => {
    // The most damaging version of this mistake is not a 422: it is an id shaped like
    // an integer reaching a uuid column, where it either fails deep in the repository
    // or, worse, matches a row someone else owns.
    expect(startVisitSchema.safeParse({ appointmentId: '1' }).success).toBe(false);
    expect(startVisitSchema.safeParse({ appointmentId: null }).success).toBe(false);
    expect(startVisitSchema.safeParse({ appointmentId: '' }).success).toBe(false);
  });

  it('drops fields the endpoint was decided not to accept', () => {
    // Not `strict()`, so the extras are stripped rather than refused, and the parsed
    // value is what the route hands the use case. The rule "a body that can restate the
    // dentist is a body that can restate the dentist wrongly" (ADR 0021) is enforced by
    // the extras never being read — a stricter schema would break a client that echoes
    // the booking it is holding, for no gain in safety.
    const result = startVisitSchema.safeParse({
      appointmentId: APPOINTMENT_ID,
      dentistId: '33333333-3333-4333-8333-333333333333',
      startedAt: '2020-01-01T00:00:00.000Z',
      clinicId: '11111111-1111-4111-8111-111111111111',
      status: 'CLOSED',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ appointmentId: APPOINTMENT_ID });
  });
});

describe('startWalkInVisitSchema', () => {
  it('accepts a patient and a clinician, with or without a chair', () => {
    expect(
      startWalkInVisitSchema.safeParse({ patientId: PATIENT_ID, dentistId: DENTIST_ID }),
    ).toEqual({
      success: true,
      data: { patientId: PATIENT_ID, dentistId: DENTIST_ID },
    });
    expect(
      startWalkInVisitSchema.safeParse({
        patientId: PATIENT_ID,
        dentistId: DENTIST_ID,
        chairId: CHAIR_ID,
      }),
    ).toEqual({
      success: true,
      data: { patientId: PATIENT_ID, dentistId: DENTIST_ID, chairId: CHAIR_ID },
    });
  });

  it('refuses a walk-in with no clinician, which is the rule the other door keeps', () => {
    // The clinician is the one field this schema argues about. A walk-in that could
    // name nobody would make "who treated this patient" depend on which button was
    // pressed (ADR 0024).
    const result = startWalkInVisitSchema.safeParse({ patientId: PATIENT_ID });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['dentistId']);
  });

  it('refuses a walk-in with no patient', () => {
    const result = startWalkInVisitSchema.safeParse({ dentistId: DENTIST_ID });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['patientId']);
  });

  it('refuses an id that is not a uuid, on either field', () => {
    for (const body of [
      { patientId: '1', dentistId: DENTIST_ID },
      { patientId: PATIENT_ID, dentistId: '' },
      { patientId: null, dentistId: DENTIST_ID },
      { patientId: PATIENT_ID, dentistId: null },
    ]) {
      expect(startWalkInVisitSchema.safeParse(body).success).toBe(false);
    }
  });

  it('drops the fields this door was decided not to accept', () => {
    // An `appointmentId` in a walk-in body is stripped, not honoured: the two doors
    // do not read each other's fields, so a client that mixed the two shapes up gets
    // a walk-in for whatever patient it named — or a 422 when it named none — and
    // never a visit quietly attached to a booking nobody meant to start.
    const result = startWalkInVisitSchema.safeParse({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      appointmentId: APPOINTMENT_ID,
      startedAt: '2020-01-01T00:00:00.000Z',
      status: 'CLOSED',
      clinicId: '11111111-1111-4111-8111-111111111111',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ patientId: PATIENT_ID, dentistId: DENTIST_ID });
  });
});
