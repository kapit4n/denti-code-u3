import { describe, expect, it } from 'vitest';
import { startVisitSchema } from './index.js';

const APPOINTMENT_ID = '44444444-4444-4444-8444-444444444444';

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
