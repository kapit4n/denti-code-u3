import { describe, expect, it } from 'vitest';
import {
  createTreatmentPlanSchema,
  createTreatmentSchema,
  updateTreatmentPlanSchema,
} from './index.js';

describe('createTreatmentSchema', () => {
  it('accepts a full catalogue row, trimming string fields', () => {
    const result = createTreatmentSchema.safeParse({
      code: '  CROWN-PM  ',
      name: '  Porcelain crown — premolar  ',
      description: '  Full-coverage all-ceramic crown.  ',
      defaultDurationMinutes: 90,
      defaultPriceMinor: 45_000,
      isActive: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      code: 'CROWN-PM',
      name: 'Porcelain crown — premolar',
      description: 'Full-coverage all-ceramic crown.',
      defaultDurationMinutes: 90,
      defaultPriceMinor: 45_000,
      isActive: true,
    });
  });

  it('accepts a minimal row: a name is the whole catalogue entry', () => {
    const result = createTreatmentSchema.safeParse({ name: 'Consultation' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: 'Consultation',
      code: undefined,
      description: undefined,
      defaultDurationMinutes: undefined,
      defaultPriceMinor: undefined,
      isActive: undefined,
    });
  });

  it('keeps explicit nulls so the domain can store them as-is', () => {
    const result = createTreatmentSchema.safeParse({
      name: 'Consultation',
      code: null,
      description: null,
      defaultDurationMinutes: null,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: 'Consultation',
      code: null,
      description: null,
      defaultDurationMinutes: null,
      defaultPriceMinor: undefined,
      isActive: undefined,
    });
  });

  it('refuses a blank name', () => {
    const result = createTreatmentSchema.safeParse({ name: '   ' });

    expect(result.success).toBe(false);
  });

  it('refuses a negative price', () => {
    const result = createTreatmentSchema.safeParse({ name: 'Root canal', defaultPriceMinor: -1 });

    expect(result.success).toBe(false);
  });

  it('refuses a fractional price', () => {
    const result = createTreatmentSchema.safeParse({ name: 'Root canal', defaultPriceMinor: 1.5 });

    expect(result.success).toBe(false);
  });

  it('refuses a price the database column cannot hold', () => {
    const result = createTreatmentSchema.safeParse({
      name: 'Root canal',
      defaultPriceMinor: 2_147_483_648,
    });

    expect(result.success).toBe(false);
  });

  it('refuses a zero or negative duration', () => {
    expect(createTreatmentSchema.safeParse({ name: 'X', defaultDurationMinutes: 0 }).success).toBe(
      false,
    );
    expect(
      createTreatmentSchema.safeParse({ name: 'X', defaultDurationMinutes: -15 }).success,
    ).toBe(false);
  });

  it('refuses a code that is no longer a code', () => {
    const result = createTreatmentSchema.safeParse({
      name: 'X',
      code: 'a'.repeat(51),
    });

    expect(result.success).toBe(false);
  });
});

describe('createTreatmentPlanSchema', () => {
  it('accepts a plan whose body names no patient and defaults the item’s surfaces and quantity', () => {
    const result = createTreatmentPlanSchema.safeParse({
      items: [{ treatmentId: '44444444-4444-4444-8444-444444444444', tooth: '16' }],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      dentistId: undefined,
      title: undefined,
      notes: undefined,
      items: [
        {
          treatmentId: '44444444-4444-4444-8444-444444444444',
          tooth: '16',
          surfaces: [],
          quantity: 1,
          estimatedPriceMinor: undefined,
          notes: undefined,
        },
      ],
    });
  });

  it('accepts an item with nothing but a note — a plan can hold a to-do', () => {
    const result = createTreatmentPlanSchema.safeParse({ items: [{ notes: 'Discuss whitening' }] });

    expect(result.success).toBe(true);
  });

  it('refuses a plan with no items', () => {
    expect(createTreatmentPlanSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('carries the odontogram’s surfaces, not an abbreviation', () => {
    expect(
      createTreatmentPlanSchema.safeParse({ items: [{ surfaces: ['MESIAL', 'OCCLUSAL'] }] })
        .success,
    ).toBe(true);
    expect(createTreatmentPlanSchema.safeParse({ items: [{ surfaces: ['MO'] }] }).success).toBe(
      false,
    );
  });

  it('refuses a tooth that is not FDI', () => {
    expect(createTreatmentPlanSchema.safeParse({ items: [{ tooth: '99' }] }).success).toBe(false);
  });
});

describe('updateTreatmentPlanSchema', () => {
  it('accepts the domain’s own status names, PROPOSED among them', () => {
    expect(updateTreatmentPlanSchema.safeParse({ status: 'PROPOSED' }).success).toBe(true);
    expect(updateTreatmentPlanSchema.safeParse({ status: 'ACCEPTED' }).success).toBe(true);
  });

  it('refuses a status the domain does not know — PRESENTED included', () => {
    expect(updateTreatmentPlanSchema.safeParse({ status: 'PRESENTED' }).success).toBe(false);
  });

  it('carries no items: moving a plan is not editing its lines', () => {
    const result = updateTreatmentPlanSchema.parse({
      status: 'ACCEPTED',
      items: [{ treatmentId: '44444444-4444-4444-8444-444444444444' }],
    });

    expect(result).toEqual({ status: 'ACCEPTED' });
  });
});
