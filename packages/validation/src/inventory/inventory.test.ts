import { describe, expect, it } from 'vitest';
import { createInventoryItemSchema, recordStockMovementSchema } from './index.js';

describe('createInventoryItemSchema', () => {
  it('accepts a full item and trims its strings', () => {
    const result = createInventoryItemSchema.safeParse({
      name: '  Composite resin A2  ',
      sku: '  COMP-A2  ',
      description: '  Syringe, shade A2  ',
      unit: '  syringe  ',
      openingStock: 12,
      minStock: 4,
      costMinor: 4_500,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: 'Composite resin A2',
      sku: 'COMP-A2',
      description: 'Syringe, shade A2',
      unit: 'syringe',
      openingStock: 12,
      minStock: 4,
      costMinor: 4_500,
    });
  });

  it('accepts a row with nothing but a name', () => {
    expect(createInventoryItemSchema.safeParse({ name: 'Gauze' }).success).toBe(true);
  });

  it('refuses a blank name, a negative count and a fractional cost', () => {
    expect(createInventoryItemSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createInventoryItemSchema.safeParse({ name: 'Gauze', openingStock: -1 }).success).toBe(
      false,
    );
    expect(createInventoryItemSchema.safeParse({ name: 'Gauze', costMinor: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('recordStockMovementSchema', () => {
  it('accepts every movement type the domain knows', () => {
    for (const type of ['PURCHASE', 'USAGE', 'ADJUSTMENT', 'RETURN', 'EXPIRED'] as const) {
      expect(recordStockMovementSchema.safeParse({ type, quantity: 2 }).success).toBe(true);
    }
  });

  it('refuses an unknown type and a zero quantity', () => {
    expect(recordStockMovementSchema.safeParse({ type: 'SHRINKAGE', quantity: 2 }).success).toBe(
      false,
    );
    expect(recordStockMovementSchema.safeParse({ type: 'USAGE', quantity: 0 }).success).toBe(false);
  });

  it('trims an optional reference and keeps nulls available', () => {
    const result = recordStockMovementSchema.safeParse({
      type: 'USAGE',
      quantity: 3,
      reference: '  Visit 42  ',
      notes: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reference).toBe('Visit 42');
      expect(result.data.notes).toBeNull();
    }
  });
});
