/**
 * `addVisitPrescription` and `listVisitPrescriptions` — the prescriptions on a visit.
 *
 * The rules themselves are thin, so what is worth testing is the decisions the file
 * makes and that would otherwise be discovered as bugs:
 *
 *  - **The visit is read before anything else, in both directions.** `prescriptions`
 *    has no clinic column, so this read is the only thing standing between a
 *    prescription and another clinic's visit — and on the read side it is the only
 *    thing standing between a foreign visit and an answer of `[]`, which reads as
 *    "nothing was prescribed" (ADR 0014).
 *  - **Who the row names is inherited, never restated.** `patientId` and `dentistId`
 *    come from the visit — the request carries only the course — and `dentistId` is
 *    nullable because the visit's can be.
 *  - **A course has to actually say something.** A blank medication, dosage or
 *    frequency writes nothing, and a course has to be whole days and at least one.
 *    The boundary schema refuses these too, but the rule is the domain's: a future
 *    caller without a schema must not be able to file a row that is not an order.
 *
 * The clock and the id generator are asserted rather than trusted, for the reason
 * `visit-write.test.ts` asserts the end time: an entity stamped by the repository is
 * an entity the use case cannot testify about.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asDentistId,
  asPatientId,
  asPrescriptionId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type { PrescriptionRepository, VisitRepository } from '../ports/index.js';
import type { Visit } from '../visit/index.js';
import type { Prescription } from './prescription.js';
import {
  addVisitPrescription,
  listVisitPrescriptions,
  type NewPrescription,
} from './visit-prescriptions.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const PRESCRIPTION = asPrescriptionId('77777777-7777-4777-8777-777777777777');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function openVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: DENTIST,
    startedAt: '2026-10-05T14:00:00.000Z' as IsoDateTime,
    status: 'OPEN',
    ...overrides,
  };
}

function aPrescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: PRESCRIPTION,
    visitId: VISIT,
    patientId: PATIENT,
    dentistId: DENTIST,
    medication: 'Ibuprofen',
    dosage: '400 mg',
    route: 'ORAL',
    frequency: 'Every 8 hours',
    durationDays: 5,
    instructions: 'Take after meals.',
    issuedAt: NOW,
    ...overrides,
  };
}

/** What the fakes recorded, so a test can assert on the calls and not only the answers. */
interface Recorded {
  saved: Prescription[];
  reads: { clinicId: ClinicId; visitId: VisitId }[];
}

/**
 * `visit: undefined` means *no such visit*, chosen with `in` rather than `??` for the
 * reason `visit-write.test.ts` gives: "the visit does not exist" and "the visit is
 * open" must not be the same fixture, or the test written for the first passes
 * against a repository holding the second.
 */
function harness(options: { visit?: Visit; stored?: readonly Prescription[] } = {}) {
  const recorded: Recorded = { saved: [], reads: [] };

  const stored: Visit | undefined = 'visit' in options ? options.visit : openVisit();

  const visits: VisitRepository = {
    findById: async (clinicId, visitId) =>
      stored && stored.id === visitId && stored.clinicId === clinicId ? stored : undefined,
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    updateStatus: async () => {},
    save: async () => {},
  };

  const prescriptions: PrescriptionRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.reads.push({ clinicId, visitId });
      return options.stored ?? [];
    },
    save: async (prescription) => {
      recorded.saved.push(prescription);
    },
  };

  return {
    recorded,
    dependencies: {
      visits,
      prescriptions,
      clock: { now: () => NOW },
      newId: () => PRESCRIPTION,
    },
  };
}

describe('addVisitPrescription', () => {
  it('writes the course the visit owns, stamped by the clock and the generator', async () => {
    const { recorded, dependencies } = harness({ visit: openVisit({ dentistId: null }) });

    const prescription = await addVisitPrescription(
      CLINIC,
      VISIT,
      {
        medication: '  Ibuprofen  ',
        dosage: ' 400 mg ',
        route: 'ORAL',
        frequency: ' Every 8 hours as needed ',
        durationDays: 5,
        instructions: ' Take after meals. ',
      },
      dependencies,
    );

    expect(prescription).toEqual({
      id: PRESCRIPTION,
      visitId: VISIT,
      // Who the row is about comes from the visit, not the request.
      patientId: PATIENT,
      dentistId: null,
      medication: 'Ibuprofen',
      dosage: '400 mg',
      route: 'ORAL',
      frequency: 'Every 8 hours as needed',
      durationDays: 5,
      instructions: 'Take after meals.',
      issuedAt: NOW,
    });
    // The use case's answer and the row it wrote are the same object; a repository
    // that re-derived either would put two accounts of one prescription in the world.
    expect(recorded.saved).toEqual([prescription]);
  });

  it('inherits the visit’s clinician when the visit names one', async () => {
    const { recorded, dependencies } = harness();

    const prescription = await addVisitPrescription(CLINIC, VISIT, course(), dependencies);

    expect(prescription.dentistId).toBe(DENTIST);
    expect(recorded.saved.at(-1)!.dentistId).toBe(DENTIST);
  });

  it('drops a blank instruction to null instead of storing an empty string', async () => {
    const { recorded, dependencies } = harness();

    const prescription = await addVisitPrescription(
      CLINIC,
      VISIT,
      { ...course(), instructions: '   ' },
      dependencies,
    );

    expect(prescription.instructions).toBeNull();
    expect(recorded.saved.at(-1)!.instructions).toBeNull();
  });

  it.each(['medication', 'dosage', 'frequency'])(
    'refuses a blank %s and writes nothing',
    async (field) => {
      const { recorded, dependencies } = harness();

      await expect(
        addVisitPrescription(CLINIC, VISIT, { ...course(), [field]: '   ' }, dependencies),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(recorded.saved).toEqual([]);
    },
  );

  it.each([0, -3, 1.5])('refuses a course of %s days', async (durationDays) => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitPrescription(CLINIC, VISIT, { ...course(), durationDays }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a course longer than a year', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitPrescription(CLINIC, VISIT, { ...course(), durationDays: 366 }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND for a visit another clinic holds, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    // The visit exists and this clinic does not hold it. Saying which of those two
    // was wrong would confirm the id is real somewhere else (ADR 0014).
    await expect(
      addVisitPrescription(OTHER_CLINIC, VISIT, course(), dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND when the visit does not exist at all', async () => {
    const { recorded, dependencies } = harness({ visit: undefined });

    await expect(addVisitPrescription(CLINIC, VISIT, course(), dependencies)).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect(recorded.saved).toEqual([]);
  });
});

describe('listVisitPrescriptions', () => {
  it('returns the prescriptions the repository holds, and asks it about this clinic’s visit', async () => {
    const held = [
      aPrescription(),
      aPrescription({ id: asPrescriptionId('88888888-8888-4888-8888-888888888888') }),
    ];
    const { recorded, dependencies } = harness({ stored: held });

    const list = await listVisitPrescriptions(CLINIC, VISIT, dependencies);

    // The list itself is the repository's, ordering included; what the use case owes
    // is the scoping, so that is what the read is asserted with.
    expect(list).toEqual(held);
    expect(recorded.reads).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, never an empty list', async () => {
    const { recorded, dependencies } = harness();

    // An empty answer here would read as "nothing was prescribed", which is a
    // different claim from "this clinic cannot see this visit" — and the two are
    // otherwise indistinguishable on a table with no clinic column (ADR 0014).
    await expect(listVisitPrescriptions(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.reads).toEqual([]);
  });

  it('answers NOT_FOUND for a visit that does not exist', async () => {
    const { dependencies } = harness({ visit: undefined });

    await expect(listVisitPrescriptions(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

/** A course that would pass every rule, so a test can vary one field at a time. */
function course(): NewPrescription {
  return {
    medication: 'Ibuprofen',
    dosage: '400 mg',
    route: 'ORAL',
    frequency: 'Every 8 hours',
    durationDays: 5,
    instructions: 'Take after meals.',
  };
}
