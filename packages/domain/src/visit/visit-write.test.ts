/**
 * `completeVisitRecord` and `reopenVisitRecord` — the two ways a visit ends.
 *
 * The transition rules themselves are pure and are tested in `visit-lifecycle.test.ts`;
 * repeating them here would assert the same thing twice. What is worth testing is
 * everything around the rule, and one of those is a decision rather than a behaviour:
 *
 *  - **the appointment is not touched.** Completing a visit leaves its booking reading
 *    `IN_TREATMENT`, and the dashboard keeps counting the patient in its `inTreatment`
 *    total until the front desk completes the booking through the appointment's own
 *    endpoint. That is ADR 0022's price for not adding a `COMPLETED → IN_TREATMENT`
 *    edge, and the test asserts it rather than leaving it to be discovered as a bug.
 *  - **the end time is the clock's.** The repository is handed the instant the domain
 *    decided, not one it works out for itself — the two differed by however long the
 *    request took before ADR 0022.
 *  - **reopening clears the end time**, because a status and an end time that disagree
 *    describe two visits.
 *  - **another clinic's visit is `NOT_FOUND`**, identically to one that does not exist.
 */

import { describe, expect, it } from 'vitest';

import {
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type { Repositories, VisitRepository } from '../ports/index.js';
import type { Visit } from '../visit/index.js';
import { completeVisitRecord, reopenVisitRecord } from './visit-write.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const CHAIR = asChairId('77777777-7777-4777-8777-777777777777');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const STARTED_AT = '2026-10-05T14:00:00.000Z' as IsoDateTime;
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function openVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: DENTIST,
    chairId: CHAIR,
    startedAt: STARTED_AT,
    status: 'OPEN',
    ...overrides,
  };
}

function completedVisit(overrides: Partial<Visit> = {}): Visit {
  return openVisit({ status: 'COMPLETED', endedAt: NOW, ...overrides });
}

/** What the fake recorded, so a test can assert on the write and not only the answer. */
interface Recorded {
  statusCalls: { visitId: VisitId; status: string; endedAt: IsoDateTime | null }[];
  appointmentTouched: boolean;
}

/**
 * `visit: undefined` means *no such visit*, so the default is chosen with `in` rather
 * than with `??` or a comparison — the first version of this file used
 * `options.visit === undefined ? openVisit() : options.visit`, which made "the visit
 * does not exist" and "the visit is open" the same fixture, and the test written to
 * prove the first case passed against a repository holding the second.
 */
function harness(options: { visit?: Visit } = {}) {
  const recorded: Recorded = { statusCalls: [], appointmentTouched: false };

  let stored: Visit | undefined = 'visit' in options ? options.visit : openVisit();

  const visits: VisitRepository = {
    findById: async (clinicId: ClinicId, visitId: VisitId) =>
      stored && stored.id === visitId && stored.clinicId === clinicId ? stored : undefined,
    updateStatus: async (_clinicId, visitId, status, endedAt) => {
      recorded.statusCalls.push({ visitId, status, endedAt });
      stored = stored
        ? { ...stored, status, ...(endedAt ? { endedAt } : { endedAt: undefined }) }
        : stored;
    },
    // The other two reads are declared and implemented but have no caller in the
    // product yet; they are not what this file is about, and a stub that throws would
    // only prove nothing calls them.
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    save: async () => {},
  };

  return {
    recorded,
    stored: () => stored,
    // The appointments repository is stubbed to *record being called*, because the point
    // of Decision 2 in ADR 0022 is that nothing here has one.
    dependencies: {
      visits: {
        ...visits,
        findById: visits.findById,
        updateStatus: visits.updateStatus,
      } as unknown as VisitRepository,
      clock: { now: () => NOW },
      appointments: new Proxy(
        {},
        {
          get: () => () => {
            recorded.appointmentTouched = true;
            return undefined;
          },
        },
      ) as unknown as Repositories['appointments'],
    },
  };
}

describe('completeVisitRecord', () => {
  it('writes the end time the clock produced, not one the repository invents', async () => {
    const { recorded, stored, dependencies } = harness();

    const completed = await completeVisitRecord(CLINIC, VISIT, dependencies);

    // The appointment started at 14:00 and the clinic is half an hour behind, which is
    // the ordinary case rather than an edge.
    expect(completed.status).toBe('COMPLETED');
    expect(completed.endedAt).toBe(NOW);
    expect(recorded.statusCalls).toEqual([{ visitId: VISIT, status: 'COMPLETED', endedAt: NOW }]);
    expect(stored()?.endedAt).toBe(NOW);
  });

  it('leaves the appointment exactly where it was', async () => {
    const { recorded, dependencies } = harness();

    await completeVisitRecord(CLINIC, VISIT, dependencies);

    // ADR 0022, Decision 2, and the reason this is a test rather than a comment: the
    // agenda will still read `IN_TREATMENT` and the dashboard will still count this
    // patient in its `inTreatment` total until the front desk completes the booking
    // through `POST /api/v1/appointments/:id/status`. Coupling the two would need a
    // `COMPLETED → IN_TREATMENT` edge, because an appointment is terminal once
    // completed, and that edge would appear as a button on every completed appointment
    // in the clinic.
    expect(recorded.appointmentTouched).toBe(false);
    expect(recorded.statusCalls).toHaveLength(1);
  });

  it('refuses to complete a visit twice', async () => {
    const { recorded, dependencies } = harness({ visit: completedVisit() });

    await expect(completeVisitRecord(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });

    expect(recorded.statusCalls).toEqual([]);
  });

  it('answers NOT_FOUND for a visit another clinic holds', async () => {
    const { recorded, dependencies } = harness();

    // The visit exists and this clinic does not hold it, so the answer must not say
    // which of those two was wrong (ADR 0014).
    await expect(completeVisitRecord(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.statusCalls).toEqual([]);
  });

  it('writes nothing when the visit does not exist at all', async () => {
    const { recorded, dependencies } = harness({ visit: undefined });

    await expect(completeVisitRecord(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.statusCalls).toEqual([]);
  });
});

describe('reopenVisitRecord', () => {
  it('opens the visit again and clears the end time', async () => {
    const { recorded, stored, dependencies } = harness({ visit: completedVisit() });

    const reopened = await reopenVisitRecord(CLINIC, VISIT, dependencies);

    // Cleared rather than left behind: a visit that says it is open again while still
    // holding the end time of a closing that no longer stands would tell the patient
    // profile two different stories about the same row.
    expect(reopened.status).toBe('OPEN');
    expect(reopened.endedAt).toBeUndefined();
    expect(recorded.statusCalls).toEqual([{ visitId: VISIT, status: 'OPEN', endedAt: null }]);
    expect(stored()?.endedAt).toBeUndefined();
  });

  it('refuses to reopen a visit that is already open', async () => {
    const { recorded, dependencies } = harness();

    await expect(reopenVisitRecord(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'ILLEGAL_TRANSITION',
    });
    expect(recorded.statusCalls).toEqual([]);
  });

  it('takes no timestamp, because there is nowhere to record one', async () => {
    const { recorded, dependencies } = harness({ visit: completedVisit() });

    await reopenVisitRecord(CLINIC, VISIT, dependencies);

    // ADR 0022, Decision 3. `updated_at` moves with the write and is the whole trace;
    // nothing records *that* this happened, which is the open question. What this test
    // pins is that the visit's own end time is not reused for the reopening — it is
    // cleared, and no second timestamp is invented in its place.
    expect(recorded.statusCalls).toHaveLength(1);
    expect(recorded.statusCalls[0]?.endedAt).toBeNull();
  });

  it('answers NOT_FOUND for a visit another clinic holds', async () => {
    const { recorded, dependencies } = harness({ visit: completedVisit() });

    await expect(reopenVisitRecord(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.statusCalls).toEqual([]);
  });
});
