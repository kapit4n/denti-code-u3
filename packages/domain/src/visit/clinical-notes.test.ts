/**
 * `addClinicalNote` and `listClinicalNotes` — the notes on a visit.
 *
 * The rules themselves are thin, so what is worth testing is the two decisions the
 * file makes and that would otherwise be discovered as bugs:
 *
 *  - **The visit is read before anything else, in both directions.** `clinical_notes`
 *    has no clinic column, so this read is the only thing standing between a note and
 *    another clinic's visit — and on the read side it is the only thing standing
 *    between a foreign visit and an answer of `[]`, which reads as "no notes were
 *    taken" (ADR 0014).
 *  - **A blank body writes nothing.** The boundary schema refuses it too, but the rule
 *    is the domain's: a future caller without a schema must not be able to file a row
 *    that says nothing.
 *
 * The clock and the id generator are asserted rather than trusted, for the reason
 * `visit-write.test.ts` asserts the end time: an entity stamped by the repository is
 * an entity the use case cannot testify about.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicalNoteId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type { ClinicalNoteRepository, VisitRepository } from '../ports/index.js';
import type { ClinicalNote, Visit } from './index.js';
import { addClinicalNote, listClinicalNotes } from './clinical-notes.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const NOTE = asClinicalNoteId('44444444-4444-4444-8444-444444444444');
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

function aNote(overrides: Partial<ClinicalNote> = {}): ClinicalNote {
  return {
    id: NOTE,
    visitId: VISIT,
    authorId: null,
    body: 'Patient reports sensitivity to cold.',
    createdAt: NOW,
    ...overrides,
  };
}

/** What the fakes recorded, so a test can assert on the calls and not only the answers. */
interface Recorded {
  saved: ClinicalNote[];
  reads: { clinicId: ClinicId; visitId: VisitId }[];
}

/**
 * `visit: undefined` means *no such visit*, chosen with `in` rather than `??` for the
 * reason `visit-write.test.ts` gives: "the visit does not exist" and "the visit is
 * open" must not be the same fixture, or the test written for the first passes
 * against a repository holding the second.
 */
function harness(options: { visit?: Visit; storedNotes?: readonly ClinicalNote[] } = {}) {
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

  const notes: ClinicalNoteRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.reads.push({ clinicId, visitId });
      return options.storedNotes ?? [];
    },
    save: async (note) => {
      recorded.saved.push(note);
    },
  };

  return {
    recorded,
    dependencies: {
      visits,
      notes,
      clock: { now: () => NOW },
      newId: () => NOTE,
    },
  };
}

describe('addClinicalNote', () => {
  it('writes the note with the clock’s time, the generator’s id and nobody as the author', async () => {
    const { recorded, dependencies } = harness();

    const note = await addClinicalNote(
      CLINIC,
      VISIT,
      '  Patient reports sensitivity.  ',
      dependencies,
    );

    expect(note).toEqual({
      id: NOTE,
      visitId: VISIT,
      authorId: null,
      body: 'Patient reports sensitivity.',
      createdAt: NOW,
    });
    // The use case's answer and the row it wrote are the same object; a repository
    // that re-derived either would put two accounts of one note in the world.
    expect(recorded.saved).toEqual([note]);
  });

  it('refuses a body of nothing and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(addClinicalNote(CLINIC, VISIT, '   \n ', dependencies)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND for a visit another clinic holds, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    // The visit exists and this clinic does not hold it. Saying which of those two
    // was wrong would confirm the id is real somewhere else (ADR 0014).
    await expect(
      addClinicalNote(OTHER_CLINIC, VISIT, 'Anything at all', dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND when the visit does not exist at all', async () => {
    const { recorded, dependencies } = harness({ visit: undefined });

    await expect(
      addClinicalNote(CLINIC, VISIT, 'Anything at all', dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });
});

describe('listClinicalNotes', () => {
  it('returns the notes the repository holds, and asks it about this clinic’s visit', async () => {
    const held = [aNote(), aNote({ id: asClinicalNoteId('55555555-5555-4555-8555-555555555556') })];
    const { recorded, dependencies } = harness({ storedNotes: held });

    const list = await listClinicalNotes(CLINIC, VISIT, dependencies);

    // The list itself is the repository's, ordering included; what the use case owes
    // is the scoping, so that is what the read is asserted with.
    expect(list).toEqual(held);
    expect(recorded.reads).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, never an empty list', async () => {
    const { recorded, dependencies } = harness();

    // An empty answer here would read as "this visit has no notes", which is a
    // different claim from "this clinic cannot see this visit" — and the two are
    // otherwise indistinguishable on a table with no clinic column (ADR 0014).
    await expect(listClinicalNotes(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.reads).toEqual([]);
  });

  it('answers NOT_FOUND for a visit that does not exist', async () => {
    const { dependencies } = harness({ visit: undefined });

    await expect(listClinicalNotes(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
