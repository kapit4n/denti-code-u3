/**
 * `addVisitAttachment` and `listVisitAttachments` — the files attached to a visit.
 *
 * The rules are thin, so what is worth testing is the two decisions the file makes
 * and that would otherwise be discovered as bugs:
 *
 *  - **The visit is read before anything else, in both directions.** `visit_attachments`
 *    has no clinic column, so this read is the only thing standing between a file and
 *    another clinic's visit — and on the read side it is the only thing standing
 *    between a foreign visit and an answer of `[]`, which reads as "no files were
 *    attached" (ADR 0014).
 *  - **A file the record cannot name is not attached.** A blank name writes nothing,
 *    and so does a negative size — metadata that contradicts itself is not metadata.
 *
 * The clock and the id generator are asserted rather than trusted, for the reason
 * `clinical-notes.test.ts` gives: an entity stamped by the repository is an entity
 * the use case cannot testify about.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitAttachmentId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type { VisitAttachmentRepository, VisitRepository } from '../ports/index.js';
import type { Visit, VisitAttachment } from './index.js';
import { addVisitAttachment, listVisitAttachments } from './visit-attachments.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const ATTACHMENT = asVisitAttachmentId('44444444-4444-4444-8444-444444444444');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function openVisit(): Visit {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: DENTIST,
    startedAt: '2026-10-05T14:00:00.000Z' as IsoDateTime,
    status: 'OPEN',
  };
}

function anAttachment(overrides: Partial<VisitAttachment> = {}): VisitAttachment {
  return {
    id: ATTACHMENT,
    visitId: VISIT,
    fileName: 'periapical-26.png',
    contentType: 'image/png',
    sizeBytes: 512_400,
    createdAt: NOW,
    ...overrides,
  };
}

/** What the fakes recorded, so a test can assert on the calls and not only the answers. */
interface Recorded {
  saved: VisitAttachment[];
  reads: { clinicId: ClinicId; visitId: VisitId }[];
}

/**
 * `visit: undefined` means *no such visit*, chosen with `in` rather than `??` for the
 * reason `clinical-notes.test.ts` gives: "the visit does not exist" and "this clinic
 * does not hold it" must not be the same fixture.
 */
function harness(options: { visit?: Visit; storedAttachments?: readonly VisitAttachment[] } = {}) {
  const recorded: Recorded = { saved: [], reads: [] };
  const visit = 'visit' in options ? options.visit : openVisit();

  const visits: VisitRepository = {
    findById: async (clinicId, visitId) =>
      visit && visit.id === visitId && visit.clinicId === clinicId ? visit : undefined,
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    updateStatus: async () => {},
    save: async () => {},
  };

  const attachments: VisitAttachmentRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.reads.push({ clinicId, visitId });
      return options.storedAttachments ?? [];
    },
    save: async (attachment) => {
      recorded.saved.push(attachment);
    },
  };

  return {
    recorded,
    dependencies: {
      visits,
      attachments,
      clock: { now: () => NOW },
      newId: () => ATTACHMENT,
    },
  };
}

describe('addVisitAttachment', () => {
  it('writes the reference with the clock’s time, the generator’s id and normalized fields', async () => {
    const { recorded, dependencies } = harness();

    const attachment = await addVisitAttachment(
      CLINIC,
      VISIT,
      '  Periapical-26.PNG  ',
      'Image/PNG',
      512_400,
      dependencies,
    );

    expect(attachment).toEqual({
      id: ATTACHMENT,
      visitId: VISIT,
      fileName: 'Periapical-26.PNG',
      contentType: 'image/png',
      sizeBytes: 512_400,
      createdAt: NOW,
    });
    expect(recorded.saved).toEqual([attachment]);
  });

  it('stores an unknown content type and size as null rather than guessed values', async () => {
    const { recorded, dependencies } = harness();

    const attachment = await addVisitAttachment(
      CLINIC,
      VISIT,
      'referral.pdf',
      '',
      null,
      dependencies,
    );

    expect(attachment).toMatchObject({ contentType: null, sizeBytes: null });
    expect(recorded.saved).toEqual([attachment]);
  });

  it('refuses a blank file name and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitAttachment(CLINIC, VISIT, '   \n ', null, null, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a negative size and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitAttachment(CLINIC, VISIT, 'periapical-26.png', null, -1, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND for a visit another clinic holds, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitAttachment(OTHER_CLINIC, VISIT, 'periapical-26.png', null, null, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });
});

describe('listVisitAttachments', () => {
  it('returns the files the repository holds, and asks it about this clinic’s visit', async () => {
    const held = [
      anAttachment(),
      anAttachment({ id: asVisitAttachmentId('55555555-5555-4555-8555-555555555556') }),
    ];
    const { recorded, dependencies } = harness({ storedAttachments: held });

    const list = await listVisitAttachments(CLINIC, VISIT, dependencies);

    expect(list).toEqual(held);
    expect(recorded.reads).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, never an empty list', async () => {
    const { recorded, dependencies } = harness();

    await expect(listVisitAttachments(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.reads).toEqual([]);
  });
});
