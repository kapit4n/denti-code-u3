/**
 * `addTreatment` — the catalogue's only write.
 *
 * The rules worth testing are the ones the write *owns*: the strings are trimmed and
 * a blank code or description is dropped to `null` (never stored empty), the price
 * is integer minor units and never negative, the duration is whole positive minutes
 * when present, and the id is the server's — the row stored is the row the caller is
 * handed back. The duplicate-code refusal is the database's unique index, translated
 * in the repository, so it is tested there, not here.
 */

import { describe, expect, it } from 'vitest';

import { asClinicId, asTreatmentId, type ClinicId } from '@denti-code-u3/types';
import type { TreatmentCatalogueItem, TreatmentRepository } from '../ports/index.js';
import { addTreatment } from './add-treatment.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const TREATMENT = asTreatmentId('44444444-4444-4444-8444-444444444444');

/** What the fake recorded, so a test can assert the write was scoped, not only answered. */
interface Recorded {
  saved: { clinicId: ClinicId; item: TreatmentCatalogueItem }[];
}

function harness() {
  const recorded: Recorded = { saved: [] };

  const treatments: TreatmentRepository = {
    listByClinic: async () => [],
    findById: async () => undefined,
    add: async (clinicId, item) => {
      recorded.saved.push({ clinicId, item });
    },
  };

  return {
    recorded,
    run: (input: Parameters<typeof addTreatment>[1]) =>
      addTreatment(CLINIC, input, {
        treatments,
        newId: () => TREATMENT,
      }),
  };
}

describe('addTreatment', () => {
  it('builds and stores the row it is handed back, trimmed and scoped to the clinic', async () => {
    const { recorded, run } = harness();

    const item = await run({
      code: '  CROWN-PM  ',
      name: '  Porcelain crown — premolar  ',
      description: '  Full-coverage all-ceramic crown.  ',
      defaultDurationMinutes: 90,
      defaultPriceMinor: 45_000,
      isActive: true,
    });

    expect(item).toEqual({
      id: TREATMENT,
      code: 'CROWN-PM',
      name: 'Porcelain crown — premolar',
      description: 'Full-coverage all-ceramic crown.',
      defaultDurationMinutes: 90,
      defaultPriceMinor: 45_000,
      isActive: true,
    });
    expect(recorded.saved).toEqual([{ clinicId: CLINIC, item }]);
  });

  it('drops a blank code and description to null rather than storing an empty string', async () => {
    const { recorded, run } = harness();

    const item = await run({ name: 'Consultation', code: '   ', description: ' ' });

    expect(item.code).toBeNull();
    expect(item.description).toBeNull();
    expect(recorded.saved).toHaveLength(1);
  });

  it('defaults the price to zero and the active flag to true when neither is said', async () => {
    const { run } = harness();

    const item = await run({ name: 'Consultation' });

    expect(item.defaultPriceMinor).toBe(0);
    expect(item.isActive).toBe(true);
    expect(item.defaultDurationMinutes).toBeNull();
  });

  it('refuses a blank name', async () => {
    const { run } = harness();

    await expect(run({ name: '   ' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { field: 'name' },
    });
  });

  it('refuses a name that stops being a name past the ceiling', async () => {
    const { run } = harness();

    await expect(run({ name: 'n'.repeat(201) })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('refuses a negative price', async () => {
    const { run } = harness();

    await expect(run({ name: 'Root canal', defaultPriceMinor: -1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { field: 'defaultPriceMinor' },
    });
  });

  it('refuses a fractional price', async () => {
    const { run } = harness();

    await expect(run({ name: 'Root canal', defaultPriceMinor: 1.5 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('refuses a zero or negative duration', async () => {
    const { run } = harness();

    await expect(run({ name: 'X', defaultDurationMinutes: 0 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { field: 'defaultDurationMinutes' },
    });
    await expect(run({ name: 'X', defaultDurationMinutes: -15 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('does not write when the row is refused', async () => {
    const { recorded, run } = harness();

    await expect(run({ name: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(recorded.saved).toHaveLength(0);
  });
});
