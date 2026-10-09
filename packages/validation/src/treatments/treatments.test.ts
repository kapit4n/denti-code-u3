import { describe, expect, it } from 'vitest';
import { createTreatmentSchema } from './index.js';

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
