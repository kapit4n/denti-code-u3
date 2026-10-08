/**
 * `recordOdontogramEntry` — the chart's one write, and the first patient-scoped book.
 *
 * The rules worth testing are the ones that would otherwise leak as bugs, and they
 * are the three decisions the file makes:
 *
 *  - **The patient is read before anything else.** `odontogram_entries` has no
 *    clinic column, so this read is the only thing standing between a charting and
 *    another clinic's patient (ADR 0014). "This clinic does not hold her" is a
 *    404 before any tooth is judged.
 *  - **Dentition is derived, never accepted.** `dentitionForTooth` turns the FDI
 *    number into the truth the column stores, and a number that is no FDI tooth at
 *    all is refused rather than charted.
 *  - **A finding is reduced before it is stored.** Surfaces are canonical-ordered
 *    and de-duplicated, a blank note is a `null`, and the whole thought is judged
 *    by `assertValidOdontogramEntry` — a site condition must name a surface, and a
 *    surface must exist on the tooth named.
 *
 * The upsert itself is the repository's (the unique index's) business and is not
 * retested here: a re-chart is just the same `save` called again. The clock, the
 * generator and the save are asserted rather than trusted, for the reason
 * `clinical-notes.test.ts` gives.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asOdontogramEntryId,
  asPatientId,
  type ClinicId,
  type IsoDateTime,
  type OdontogramEntryId,
} from '@denti-code-u3/types';
import type { PatientOdontogram } from '../patient/index.js';
import type { OdontogramEntryRepository, PatientRepository } from '../ports/index.js';
import type { OdontogramEntryRecord } from './odontogram-entry.js';
import { recordOdontogramEntry } from './odontogram-entry.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const ENTRY = asOdontogramEntryId('44444444-4444-4444-8444-444444444444');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function anOpenChart(): PatientOdontogram {
  return { entries: [] };
}

/** What the fakes recorded, so a test can assert on the calls and not only the answers. */
interface Recorded {
  saved: OdontogramEntryRecord[];
  reads: { clinicId: ClinicId; patientId: string }[];
}

/**
 * `chart: undefined` means *no such patient*, chosen with `in` rather than `??` for
 * the reason `clinical-notes.test.ts` gives: "the patient does not exist" and "this
 * clinic does not hold her" must not be the same fixture.
 */
function harness(options: { chart?: PatientOdontogram } = {}) {
  const recorded: Recorded = { saved: [], reads: [] };
  const chart = 'chart' in options ? options.chart : anOpenChart();

  const patients: Pick<PatientRepository, 'findOdontogram'> = {
    findOdontogram: async (clinicId, patientId) => {
      recorded.reads.push({ clinicId, patientId });
      return clinicId === CLINIC ? chart : undefined;
    },
  };

  const entries: OdontogramEntryRepository = {
    save: async (entry) => {
      recorded.saved.push(entry);
    },
  };

  return {
    recorded,
    dependencies: {
      patients,
      entries,
      clock: { now: () => NOW },
      newId: (): OdontogramEntryId => ENTRY,
    },
  };
}

describe('recordOdontogramEntry', () => {
  it('charts a permanent tooth, deriving the dentition from the number and stamping it with the clock', async () => {
    const { recorded, dependencies } = harness();

    const entry = await recordOdontogramEntry(
      CLINIC,
      PATIENT,
      {
        tooth: '16',
        condition: 'CARIES',
        surfaces: ['MESIAL', 'OCCLUSAL'],
        notes: '  Patch visible on the film.  ',
      },
      dependencies,
    );

    expect(entry).toEqual({
      id: ENTRY,
      patientId: PATIENT,
      visitId: null,
      dentition: 'PERMANENT',
      tooth: '16',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      condition: 'CARIES',
      notes: 'Patch visible on the film.',
      recordedAt: NOW,
    });
    expect(recorded.saved).toEqual([entry]);
  });

  it('charts a primary tooth whose surfaces are reduced to canonical order and freed of duplicates', async () => {
    const { recorded, dependencies } = harness();

    const entry = await recordOdontogramEntry(
      CLINIC,
      PATIENT,
      { tooth: '75', condition: 'FILLED', surfaces: ['DISTAL', 'MESIAL', 'MESIAL'] },
      dependencies,
    );

    expect(entry).toMatchObject({
      dentition: 'PRIMARY',
      tooth: '75',
      surfaces: ['MESIAL', 'DISTAL'],
    });
    expect(recorded.saved).toEqual([entry]);
  });

  it('accepts a whole-tooth condition with no surfaces, and a blank note stored as null', async () => {
    const { recorded, dependencies } = harness();

    const entry = await recordOdontogramEntry(
      CLINIC,
      PATIENT,
      { tooth: '36', condition: 'CROWN', surfaces: [], notes: '   ' },
      dependencies,
    );

    expect(entry).toMatchObject({ dentition: 'PERMANENT', tooth: '36', surfaces: [], notes: null });
    expect(recorded.saved).toEqual([entry]);
  });

  it('refuses a tooth that is not FDI, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      recordOdontogramEntry(
        CLINIC,
        PATIENT,
        { tooth: '99', condition: 'HEALTHY', surfaces: [] },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a site condition without a surface, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      recordOdontogramEntry(
        CLINIC,
        PATIENT,
        { tooth: '46', condition: 'CARIES', surfaces: [] },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a surface the tooth does not have, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      recordOdontogramEntry(
        CLINIC,
        PATIENT,
        { tooth: '12', condition: 'CARIES', surfaces: ['OCCLUSAL'] },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND for a patient this clinic does not hold, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      recordOdontogramEntry(
        OTHER_CLINIC,
        PATIENT,
        { tooth: '16', condition: 'HEALTHY', surfaces: [] },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.reads).toEqual([{ clinicId: OTHER_CLINIC, patientId: PATIENT }]);
    expect(recorded.saved).toEqual([]);
  });

  it('charts the same tooth again as another save: the replacement is the repository’s upsert', async () => {
    const { recorded, dependencies } = harness();

    const first = await recordOdontogramEntry(
      CLINIC,
      PATIENT,
      { tooth: '16', condition: 'CARIES', surfaces: ['MESIAL'] },
      dependencies,
    );
    const second = await recordOdontogramEntry(
      CLINIC,
      PATIENT,
      { tooth: '16', condition: 'FILLED', surfaces: ['MESIAL'] },
      dependencies,
    );

    expect(recorded.saved).toEqual([first, second]);
    expect(second.tooth).toBe('16');
  });
});
