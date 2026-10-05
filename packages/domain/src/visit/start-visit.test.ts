/**
 * `startVisit` — the use case, tested without a database.
 *
 * The rules this use case enforces were already tested as pure functions in
 * `visit-lifecycle.test.ts`, and duplicating them here would be asserting the same
 * thing twice. What is worth testing here is the part a pure function cannot do:
 *
 *  - **the two rows go through one transaction**, and a refusal part-way through
 *    leaves neither of them written. That is the whole reason this use case exists, and
 *    a test that only checked the happy path would pass against an implementation that
 *    wrote the visit and forgot the appointment;
 *  - **the visit is written first**, because the appointment's `visit_id` has a foreign
 *    key to the row the next statement writes;
 *  - the answers that are about the clinic rather than the rules: a booking this clinic
 *    does not hold is `NOT_FOUND`, and a booking that disappeared between the read and
 *    the write is the same answer.
 *
 * The concurrency case — two clinicians pressing the same button at the same instant —
 * cannot be written here at all, because a fake has no notion of two writers being
 * visible at once. That is `visits.integration.test.ts`'s job, against the real unique
 * index.
 */

import { describe, expect, it } from 'vitest';

import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type AppointmentId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type { Appointment, AppointmentStatus } from '../appointment/index.js';
import type {
  AppointmentRepository,
  Repositories,
  UnitOfWork,
  VisitRepository,
} from '../ports/index.js';
import type { Visit } from '../visit/index.js';
import { DomainError } from '../shared/errors.js';
import { startVisit } from './start-visit.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const CHAIR = asChairId('77777777-7777-4777-8777-777777777777');
const APPOINTMENT_ID = asAppointmentId('44444444-4444-4444-8444-444444444444');
const VISIT_ID = asVisitId('33333333-3333-4333-8333-333333333333');
const BOOKED_AT = '2026-10-05T14:00:00.000Z' as IsoDateTime;
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function scheduled(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: APPOINTMENT_ID,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: DENTIST,
    chairId: CHAIR,
    startsAt: BOOKED_AT,
    durationMinutes: 45,
    status: 'ARRIVED',
    ...overrides,
  };
}

/** What the fake recorded, so a test can assert on the writes rather than the answer. */
interface Recorded {
  visits: Visit[];
  moves: { visitId: VisitId; status: AppointmentStatus }[];
  transactions: number;
  /** Makes `becomeVisit` behave as if the booking had vanished mid-write. */
  vanishOnUpdate: boolean;
  /** Makes `becomeVisit` fail, to prove the visit written before it is rolled back. */
  failOnUpdate: boolean;
}

function harness(options: { appointment?: Appointment | undefined } & Partial<Recorded> = {}) {
  const recorded: Recorded = {
    visits: [],
    moves: [],
    transactions: 0,
    vanishOnUpdate: false,
    failOnUpdate: false,
    ...options,
  };

  let stored: Appointment | undefined =
    options.appointment === undefined ? scheduled() : options.appointment;

  const appointments = {
    findById: async (scope: ClinicId, appointmentId: AppointmentId) =>
      stored && stored.id === appointmentId && stored.clinicId === scope ? stored : undefined,
    becomeVisit: async (
      _scope: ClinicId,
      _appointmentId: AppointmentId,
      visitId: VisitId,
      status: AppointmentStatus,
    ) => {
      if (recorded.failOnUpdate) {
        throw new Error('the second write failed');
      }
      if (recorded.vanishOnUpdate) {
        stored = undefined;
        return undefined;
      }
      recorded.moves.push({ visitId, status });
      stored = stored ? { ...stored, visitId, status } : undefined;
      return stored;
    },
  } as unknown as AppointmentRepository;

  const visits: VisitRepository = {
    save: async (visit: Visit) => {
      recorded.visits.push(visit);
    },
  } as unknown as VisitRepository;

  const unitOfWork: UnitOfWork = {
    transaction: async (work) => {
      recorded.transactions += 1;
      try {
        return await work({ appointments, visits } as unknown as Repositories);
      } catch (error) {
        // A rolled-back transaction keeps neither write, which is what makes the
        // "refused part-way" assertions below mean something.
        recorded.visits.length = 0;
        recorded.moves.length = 0;
        throw error;
      }
    },
  };

  return {
    recorded,
    stored: () => stored,
    dependencies: {
      unitOfWork,
      clock: { now: () => NOW },
      newId: (): VisitId => VISIT_ID,
    },
  };
}

describe('startVisit', () => {
  it('writes the visit and moves its appointment in one transaction', async () => {
    const { recorded, stored, dependencies } = harness();

    const started = await startVisit(CLINIC, APPOINTMENT_ID, dependencies);

    expect(recorded.transactions).toBe(1);
    expect(started.visit).toMatchObject({
      id: VISIT_ID,
      clinicId: CLINIC,
      patientId: PATIENT,
      dentistId: DENTIST,
      chairId: CHAIR,
      appointmentId: APPOINTMENT_ID,
      status: 'OPEN',
      startedAt: NOW,
    });
    expect(started.appointment).toMatchObject({
      status: 'IN_TREATMENT',
      visitId: VISIT_ID,
    });
    expect(stored()?.status).toBe('IN_TREATMENT');
  });

  it('writes the visit before the appointment, because the appointment names it', async () => {
    const order: string[] = [];
    const { dependencies } = harness();

    const unitOfWork: UnitOfWork = {
      transaction: (work) =>
        dependencies.unitOfWork.transaction((repositories) =>
          work({
            ...repositories,
            visits: {
              ...repositories.visits,
              save: async (visit: Visit) => {
                order.push('visit');
                return repositories.visits.save(visit);
              },
            },
            appointments: {
              ...repositories.appointments,
              becomeVisit: async (
                scope: ClinicId,
                appointmentId: AppointmentId,
                visitId: VisitId,
                status: AppointmentStatus,
              ) => {
                order.push('appointment');
                return repositories.appointments.becomeVisit(scope, appointmentId, visitId, status);
              },
            },
          } as unknown as Repositories),
        ),
    };

    await startVisit(CLINIC, APPOINTMENT_ID, { ...dependencies, unitOfWork });

    // The foreign key on `appointments.visit_id` makes the other order a constraint
    // violation rather than a race, so this is not a style preference.
    expect(order).toEqual(['visit', 'appointment']);
  });

  it('leaves nothing behind when the domain refuses', async () => {
    const { recorded, stored, dependencies } = harness({
      appointment: scheduled({ status: 'COMPLETED' }),
    });

    await expect(startVisit(CLINIC, APPOINTMENT_ID, dependencies)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });

    expect(recorded.visits).toEqual([]);
    expect(recorded.moves).toEqual([]);
    expect(stored()?.visitId).toBeUndefined();
  });

  it('rolls the visit back when the appointment cannot be moved', async () => {
    const { recorded, dependencies } = harness({ failOnUpdate: true });

    await expect(startVisit(CLINIC, APPOINTMENT_ID, dependencies)).rejects.toThrow(
      'the second write failed',
    );

    // The visit was written a statement earlier. Without the transaction there would be
    // an open visit here and an appointment still reading as waiting — the state this
    // use case exists to make impossible.
    expect(recorded.visits).toEqual([]);
  });

  it('refuses an appointment that already became a visit', async () => {
    const { dependencies } = harness({ appointment: scheduled({ visitId: VISIT_ID }) });

    await expect(startVisit(CLINIC, APPOINTMENT_ID, dependencies)).rejects.toMatchObject({
      code: 'DUPLICATED_RECORD',
    });
  });

  it('refuses an appointment whose dentist has left the clinic', async () => {
    const { dependencies } = harness({ appointment: scheduled({ dentistId: null }) });

    await expect(startVisit(CLINIC, APPOINTMENT_ID, dependencies)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('answers NOT_FOUND for a booking this clinic does not hold', async () => {
    const { recorded, dependencies } = harness();

    // The appointment exists; this clinic does not hold it. Saying which of the two was
    // wrong would leak that the id is real somewhere else (ADR 0014).
    await expect(startVisit(OTHER_CLINIC, APPOINTMENT_ID, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.visits).toEqual([]);
  });

  it('answers NOT_FOUND, not a half-written visit, when the booking vanishes mid-write', async () => {
    const { recorded, dependencies } = harness({ vanishOnUpdate: true });

    await expect(startVisit(CLINIC, APPOINTMENT_ID, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(recorded.visits).toEqual([]);
    expect(recorded.moves).toEqual([]);
  });

  it('uses the clock, not the booking time, as the visit time', async () => {
    const { recorded, dependencies } = harness();

    await startVisit(CLINIC, APPOINTMENT_ID, dependencies);

    // The booking was for 14:00 and the clock says 14:30 — a half-hour late, which is
    // the ordinary case rather than an edge. A visit filed at the booked time would make
    // every running-late clinic look punctual in its own records.
    expect(recorded.visits[0]?.startedAt).toBe(NOW);
  });

  it('consumes no identifier for a booking this clinic does not hold', async () => {
    let allocated = 0;
    const { dependencies } = harness();

    await expect(
      startVisit(OTHER_CLINIC, APPOINTMENT_ID, {
        ...dependencies,
        newId: () => {
          allocated += 1;
          return VISIT_ID;
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A booking that does not exist cannot need a number. The narrower claim — that a
    // *refused* booking consumes none — is not true here and this test does not imply
    // it: the id has to exist before the pure function can refuse, and deferring it
    // would mean moving id allocation inside `startVisitFromAppointment`.
    expect(allocated).toBe(0);
  });

  it('reports a refusal as a DomainError, so a route can turn it into a status', async () => {
    const { dependencies } = harness({ appointment: scheduled({ status: 'COMPLETED' }) });

    await expect(startVisit(CLINIC, APPOINTMENT_ID, dependencies)).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('writes the visit into the clinic it was asked about', async () => {
    const { recorded, dependencies } = harness({
      appointment: scheduled({ clinicId: OTHER_CLINIC }),
    });

    await startVisit(OTHER_CLINIC, APPOINTMENT_ID, dependencies);

    // Not the clinic from the request scope and not the one on the appointment: the use
    // case is given a clinic and asked about that clinic's booking, and the row records
    // what was actually written.
    expect(recorded.visits[0]?.clinicId).toBe(OTHER_CLINIC);
  });
});
