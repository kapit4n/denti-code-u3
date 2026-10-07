/**
 * `recordVisitTreatment` and `listTreatmentRecords` — what was done in a visit.
 *
 * The rules worth testing are the two scoping reads and the tooth rule:
 *
 *  - **The visit is read before anything is written or listed.** The record table has
 *    no clinic column, so the visit is the only tenant key; a foreign visit is
 *    `NOT_FOUND` on both sides (ADR 0014).
 *  - **The treatment is the second scoping read, and it is `INVALID_INPUT`, not
 *    `NOT_FOUND`.** The visit is the subject of the record; the treatment is a resource
 *    being named, and the codebase's answer for a named resource this clinic does not
 *    hold is the same `INVALID_INPUT` the FK translation gives a foreign dentist or
 *    chair (ADR 0024). "Not in the catalogue" and "no such treatment" are deliberately
 *    one answer.
 *  - **`tooth` is a clinical rule, so it lives in the domain.** The boundary schema
 *    only checks the two-digit shape; whether the digits name a real tooth is judged
 *    here, permanent and primary dentitions alike.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asDentistId,
  asPatientId,
  asTreatmentId,
  asVisitId,
  asVisitTreatmentExecutionId,
  type ClinicId,
  type IsoDateTime,
  type TreatmentId,
  type VisitId,
} from '@denti-code-u3/types';
import type {
  TreatmentCatalogueItem,
  TreatmentRecordRepository,
  TreatmentRepository,
  VisitRepository,
} from '../ports/index.js';
import type { Visit } from '../visit/index.js';
import {
  type TreatmentRecord,
  listTreatmentRecords,
  recordVisitTreatment,
} from './visit-treatment-records.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const TREATMENT = asTreatmentId('44444444-4444-4444-8444-444444444444');
const RECORD_ID = asVisitTreatmentExecutionId('55555555-5555-4555-8555-555555555558');
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

function aTreatment(overrides: Partial<TreatmentCatalogueItem> = {}): TreatmentCatalogueItem {
  return {
    id: TREATMENT,
    code: 'COMPO-POSTERIOR',
    name: 'Composite restoration — posterior',
    description: null,
    defaultDurationMinutes: 60,
    defaultPriceMinor: 15000,
    isActive: true,
    ...overrides,
  };
}

function aRecord(overrides: Partial<TreatmentRecord> = {}): TreatmentRecord {
  return {
    id: RECORD_ID,
    visitId: VISIT,
    treatmentId: TREATMENT,
    tooth: '36',
    notes: null,
    performedAt: NOW,
    ...overrides,
  };
}

/** What the fakes recorded, so a test can assert on the calls and not only the answers. */
interface Recorded {
  saved: TreatmentRecord[];
  reads: { clinicId: ClinicId; visitId: VisitId }[];
  catalogueReads: { clinicId: ClinicId; treatmentId: TreatmentId }[];
}

/**
 * `visit: undefined` and `catalogue: []` are each chosen with `in` rather than `??`
 * for the reason `clinical-notes.test.ts` gives: "the visit does not exist" and "the
 * visit is open" must not be the same fixture, and an empty catalogue must be
 * distinguishable from an unopened one.
 */
function harness(
  options: {
    visit?: Visit;
    catalogue?: readonly TreatmentCatalogueItem[];
    held?: readonly TreatmentRecord[];
  } = {},
) {
  const recorded: Recorded = { saved: [], reads: [], catalogueReads: [] };
  const catalogue = 'catalogue' in options ? (options.catalogue ?? []) : [aTreatment()];
  const held = options.held ?? [];
  const stored: Visit | undefined = 'visit' in options ? options.visit : openVisit();

  const visits: VisitRepository = {
    findById: async (clinicId, visitId) =>
      stored && stored.id === visitId && stored.clinicId === clinicId ? stored : undefined,
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    updateStatus: async () => {},
    save: async () => {},
  };

  const treatments: TreatmentRepository = {
    listByClinic: async () => catalogue,
    findById: async (clinicId, treatmentId) => {
      recorded.catalogueReads.push({ clinicId, treatmentId });
      return catalogue.find((item) => item.id === treatmentId);
    },
  };

  const treatmentRecords: TreatmentRecordRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.reads.push({ clinicId, visitId });
      return held;
    },
    save: async (record) => {
      recorded.saved.push(record);
    },
  };

  return {
    recorded,
    dependencies: {
      visits,
      treatments,
      treatmentRecords,
      clock: { now: () => NOW },
      newId: () => RECORD_ID,
    },
  };
}

describe('recordVisitTreatment', () => {
  it('writes the record with the clock’s time, the generator’s id and trimmed fields', async () => {
    const { recorded, dependencies } = harness();

    const record = await recordVisitTreatment(
      CLINIC,
      VISIT,
      { treatmentId: TREATMENT, tooth: ' 36 ', notes: '  No complications.  ' },
      dependencies,
    );

    expect(record).toEqual({
      id: RECORD_ID,
      visitId: VISIT,
      treatmentId: TREATMENT,
      tooth: '36',
      notes: 'No complications.',
      performedAt: NOW,
    });
    expect(recorded.saved).toEqual([record]);
    // Both scoping reads happened: the visit and the treatment, in that order.
    expect(recorded.catalogueReads).toEqual([{ clinicId: CLINIC, treatmentId: TREATMENT }]);
  });

  it('drops a blank tooth and blank notes to null, never to empty strings', async () => {
    const { recorded, dependencies } = harness();

    const record = await recordVisitTreatment(
      CLINIC,
      VISIT,
      { treatmentId: TREATMENT, tooth: '   ', notes: '' },
      dependencies,
    );

    expect(record.tooth).toBeNull();
    expect(record.notes).toBeNull();
    expect(recorded.saved[0]).toEqual(record);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      recordVisitTreatment(OTHER_CLINIC, VISIT, { treatmentId: TREATMENT }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND when the visit does not exist, even before the catalogue is read', async () => {
    const { recorded, dependencies } = harness({ visit: undefined });

    await expect(
      recordVisitTreatment(
        CLINIC,
        asVisitId('00000000-0000-4000-8000-000000000000'),
        {
          treatmentId: TREATMENT,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.catalogueReads).toEqual([]);
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a treatment that is not in this clinic’s catalogue, and writes nothing', async () => {
    const { recorded, dependencies } = harness({ catalogue: [] });

    await expect(
      recordVisitTreatment(CLINIC, VISIT, { treatmentId: TREATMENT }, dependencies),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'That treatment is not in this clinic\u2019s catalogue',
    });
    expect(recorded.saved).toEqual([]);
  });

  it('accepts a primary-tooth FDI number', async () => {
    const { recorded, dependencies } = harness();

    const record = await recordVisitTreatment(
      CLINIC,
      VISIT,
      { treatmentId: TREATMENT, tooth: '75' },
      dependencies,
    );

    expect(record.tooth).toBe('75');
    expect(recorded.saved).toHaveLength(1);
  });

  it('refuses a tooth that is not an FDI number', async () => {
    const { recorded, dependencies } = harness();

    for (const tooth of ['00', '50', '9', '16.5']) {
      await expect(
        recordVisitTreatment(CLINIC, VISIT, { treatmentId: TREATMENT, tooth }, dependencies),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(recorded.saved).toEqual([]);
  });
});

describe('listTreatmentRecords', () => {
  it('returns what the repository holds, having asked it about this clinic’s visit', async () => {
    const held = [aRecord(), aRecord({ tooth: '26' })];
    const { recorded, dependencies } = harness({ held });

    const list = await listTreatmentRecords(CLINIC, VISIT, dependencies);

    expect(list).toEqual(held);
    expect(recorded.reads).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, never an empty list', async () => {
    const { recorded, dependencies } = harness();

    await expect(listTreatmentRecords(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.reads).toEqual([]);
  });
});
