/**
 * Reading a visit.
 *
 * Two use cases that are nearly nothing, which is why this file has few tests. What
 * deserves testing is not "the repository was called" — that is the repository's test —
 * but the two answers that are decisions rather than plumbing:
 *
 *  - **an empty timeline is `200 []`, not `404`.** A patient who has never been treated
 *    is not a missing patient. The test says so explicitly because the *other* read in
 *    this codebase, `GET /patients/:id`, answers `404` for a patient this clinic does
 *    not hold, and copying that reflex here would produce a timeline that 404s every
 *    untreated patient.
 *  - **another clinic's patient also answers `[]`.** Not because the patient is absent
 *    — because a list endpoint cannot refuse to answer "does this patient exist here"
 *    without leaking "does this patient exist somewhere". It answers one question: which
 *    visits may I read. For a patient outside this clinic that is none (ADR 0014).
 *
 * The `[]`-for-two-different-reasons is asserted *once*, deliberately, by checking that
 * the two calls return the same value — because the property that matters is that a
 * caller cannot tell them apart, and that is only testable by comparison.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asPatientId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type PatientId,
  type VisitId,
} from '@denti-code-u3/types';
import type { VisitRepository } from '../ports/index.js';
import type { Visit } from './visit-lifecycle.js';
import { getVisit, listVisitsForPatient } from './visit-read.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const OTHER_PATIENT = asPatientId('88888888-8888-4888-8888-888888888888');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const STARTED_AT = '2026-10-05T14:00:00.000Z' as IsoDateTime;
const ENDED_AT = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: null,
    status: 'OPEN',
    startedAt: STARTED_AT,
    ...overrides,
  };
}

/**
 * `byId: undefined` means *no such visit*, so the default is chosen with `in` rather
 * than with a comparison against `undefined`.
 *
 * The first version of this file used `options.byId === undefined ? visit() : options.byId`
 * — the same trap that the visit write tests hit in session 24 — which made "the visit
 * does not exist" and "the visit exists" one fixture, and let the test written to prove
 * the first case pass against a repository holding the second.
 */
function harness(options: { byId?: Visit; forPatient?: readonly Visit[] } = {}) {
  const calls: string[] = [];
  const held = 'byId' in options ? options.byId : visit();

  const repository: VisitRepository = {
    findById: async (clinicId: ClinicId, visitId: VisitId) => {
      calls.push(`findById:${clinicId}`);
      return held && held.id === visitId && held.clinicId === clinicId ? held : undefined;
    },
    findForPatient: async (clinicId: ClinicId, patientId: PatientId) => {
      calls.push(`findForPatient:${clinicId}:${patientId}`);
      if (clinicId !== CLINIC || patientId !== PATIENT) {
        return [];
      }
      return options.forPatient ?? [];
    },
    findOpenForPatient: async () => undefined,
    updateStatus: async () => {},
    save: async () => {},
  };

  return { calls, dependencies: { visits: repository } };
}

describe('getVisit', () => {
  it('answers the visit this clinic holds', async () => {
    const { calls, dependencies } = harness({
      byId: visit({ status: 'COMPLETED', endedAt: ENDED_AT }),
    });

    const found = await getVisit(CLINIC, VISIT, dependencies);

    expect(found).toMatchObject({ id: VISIT, status: 'COMPLETED', endedAt: ENDED_AT });
    // The clinic is handed to the one method that can scope a query, so no caller can
    // forget it — the same commitment the patient read side makes.
    expect(calls).toEqual([`findById:${CLINIC}`]);
  });

  it('carries the nullable clinician through rather than dropping the key', async () => {
    // A clinician who has left the clinic leaves a null behind. Omitting the key instead
    // would make "has no clinician" indistinguishable from "was never asked" (ADR 0021).
    const { dependencies } = harness({ byId: visit({ dentistId: null }) });

    const found = await getVisit(CLINIC, VISIT, dependencies);

    expect('dentistId' in found).toBe(true);
    expect(found.dentistId).toBeNull();
  });

  it('answers NOT_FOUND for a visit another clinic holds', async () => {
    const { calls, dependencies } = harness();

    await expect(getVisit(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(calls).toEqual([`findById:${OTHER_CLINIC}`]);
  });

  it('answers NOT_FOUND for a visit that is nowhere', async () => {
    const { dependencies } = harness({ byId: undefined });

    await expect(getVisit(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('listVisitsForPatient', () => {
  it('answers the visits in the order the repository gave them', async () => {
    const older = visit({
      id: asVisitId('44444444-4444-4444-8444-444444444444'),
      startedAt: '2026-01-01T09:00:00.000Z' as IsoDateTime,
    });
    const newer = visit({ id: VISIT, startedAt: STARTED_AT });
    const { calls, dependencies } = harness({ forPatient: [newer, older] });

    const list = await listVisitsForPatient(CLINIC, PATIENT, dependencies);

    // The domain does not re-sort. The repository owns the ordering because the ordering
    // is a property of the table's index, and a second `sort` here would silently
    // disagree with it if that index's order ever changed.
    expect(list.map((entry) => entry.id)).toEqual([VISIT, older.id]);
    expect(calls).toEqual([`findForPatient:${CLINIC}:${PATIENT}`]);
  });

  it('answers an empty list for a patient who has never been treated', async () => {
    const { dependencies } = harness({ forPatient: [] });

    // 200 with `[]`. `GET /patients/:id` answers 404 for a patient this clinic does not
    // hold, and copying that reflex here would produce a timeline that 404s every
    // untreated patient — a rule wearing a bug's clothes.
    await expect(listVisitsForPatient(CLINIC, OTHER_PATIENT, dependencies)).resolves.toEqual([]);
  });

  it('answers exactly the same thing for another clinic, which is the point', async () => {
    const { dependencies } = harness({ forPatient: [] });

    const treated = await listVisitsForPatient(CLINIC, PATIENT, dependencies);
    const foreign = await listVisitsForPatient(OTHER_CLINIC, PATIENT, dependencies);

    // Asserted by comparison rather than by two separate expectations, because the
    // property that matters is that a caller *cannot tell them apart* — and that is only
    // checkable by holding the two answers side by side. A list endpoint cannot refuse to
    // answer "does this patient exist here" without leaking "does this patient exist
    // somewhere" (ADR 0014).
    expect(foreign).toEqual(treated);
  });
});
