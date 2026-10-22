/**
 * Inventory: the item catalogue and the stock ledger.
 *
 * The decisions worth pinning are the ones a later reader could get wrong without
 * noticing:
 *
 *  - **Opening stock is a movement.** An item that arrives with stock on the shelf
 *    writes the item and an `ADJUSTMENT` in one transaction, so the cached level and
 *    the ledger agree from the first read. Zero stock writes no row — it is the
 *    absence of an event, not an event.
 *  - **Direction belongs to the type.** `USAGE` and `EXPIRED` take stock out;
 *    `PURCHASE`, `RETURN` and `ADJUSTMENT` put it in. The quantity is always positive,
 *    so no reader has to remember a sign.
 *  - **A movement and its level are written together.** The item is read inside the
 *    transaction, the domain computes the next level, and both the ledger row and the
 *    cached level are written — or nothing is.
 *  - **A refused movement writes nothing.** Missing items are `NOT_FOUND` and
 *    over-use is `INSUFFICIENT_STOCK`; neither leaves a movement behind.
 */
import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asInventoryItemId,
  type ClinicId,
  type InventoryItemId,
  type IsoDateTime,
} from '@denti-code-u3/types';
import type { InventoryRepository, Repositories, UnitOfWork } from '../ports/index.js';
import type { InventoryItem, StockMovement } from './inventory.js';
import { applyStockMovement, isLowStock } from './inventory.js';
import { addInventoryItem } from './add-inventory-item.js';
import { recordStockMovement } from './record-stock-movement.js';

const CLINIC = asClinicId('a1a1a1a1-1111-4111-8111-111111111111');
const OTHER_CLINIC = asClinicId('a1a1a1a1-2222-4222-8222-222222222222');
const ITEM = asInventoryItemId('a1a1a1a1-3333-4333-8333-333333333333');
const NEW_ITEM = asInventoryItemId('a1a1a1a1-4444-4444-8444-444444444444');
const MOVEMENT = 'a1a1a1a1-5555-4555-8555-555555555555';
const NOW = '2026-10-22T14:30:00.000Z' as IsoDateTime;

function anItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: ITEM,
    clinicId: CLINIC,
    name: 'Composite resin A2',
    sku: 'COMP-A2',
    description: null,
    unit: 'syringe',
    stock: 10,
    minStock: 3,
    costMinor: 4_500,
    isActive: true,
    ...overrides,
  };
}

interface Recorded {
  readonly items: InventoryItem[];
  readonly movements: StockMovement[];
  readonly stockWrites: { clinicId: ClinicId; itemId: InventoryItemId; stock: number }[];
  readonly reads: { clinicId: ClinicId; itemId: InventoryItemId }[];
}

function harness(options: { stored?: InventoryItem } = {}) {
  const recorded: Recorded = {
    items: [],
    movements: [],
    stockWrites: [],
    reads: [],
  };

  const inventory: InventoryRepository = {
    listByClinic: async () => (options.stored ? [options.stored] : []),
    findById: async (clinicId, itemId) => {
      recorded.reads.push({ clinicId, itemId });
      return options.stored;
    },
    add: async (_clinicId, item) => {
      recorded.items.push(item);
    },
    updateStock: async (clinicId, itemId, stock) => {
      recorded.stockWrites.push({ clinicId, itemId, stock });
    },
    addMovement: async (movement) => {
      recorded.movements.push(movement);
    },
    listMovements: async () => recorded.movements,
  };

  const unitOfWork: UnitOfWork = {
    transaction: async (work) => work({ inventory } as unknown as Repositories),
  };

  return {
    recorded,
    dependencies: {
      unitOfWork,
      clock: { now: () => NOW },
      newItemId: () => NEW_ITEM,
      newMovementId: () => MOVEMENT,
    },
  };
}

describe('isLowStock', () => {
  it('is low at or below the minimum, and not above it', () => {
    expect(isLowStock({ stock: 2, minStock: 3 })).toBe(true);
    expect(isLowStock({ stock: 3, minStock: 3 })).toBe(true);
    expect(isLowStock({ stock: 4, minStock: 3 })).toBe(false);
  });
});

describe('applyStockMovement', () => {
  it('takes stock out for usage and expiry, and puts it in for purchases, returns and adjustments', () => {
    expect(applyStockMovement(anItem(), 'USAGE', 4).stock).toBe(6);
    expect(applyStockMovement(anItem(), 'EXPIRED', 2).stock).toBe(8);
    expect(applyStockMovement(anItem(), 'PURCHASE', 5).stock).toBe(15);
    expect(applyStockMovement(anItem(), 'RETURN', 1).stock).toBe(11);
    expect(applyStockMovement(anItem(), 'ADJUSTMENT', 2).stock).toBe(12);
  });

  it('refuses an outflow larger than the stock on hand rather than clamping it', () => {
    expect(() => applyStockMovement(anItem({ stock: 2 }), 'USAGE', 3)).toThrowError(
      /Not enough stock/,
    );
  });

  it('refuses a quantity that is not a positive integer', () => {
    expect(() => applyStockMovement(anItem(), 'USAGE', 0)).toThrowError(/positive integer/);
    expect(() => applyStockMovement(anItem(), 'USAGE', 1.5)).toThrowError(/positive integer/);
  });
});

describe('addInventoryItem', () => {
  it('adds a minimal item with the defaults, no ledger row for zero opening stock', async () => {
    const { recorded, dependencies } = harness();

    const item = await addInventoryItem(CLINIC, { name: '  Gauze  ' }, dependencies);

    expect(item).toEqual({
      id: NEW_ITEM,
      clinicId: CLINIC,
      name: 'Gauze',
      sku: null,
      description: null,
      unit: 'unit',
      stock: 0,
      minStock: 0,
      costMinor: 0,
      isActive: true,
    });
    expect(recorded.items).toEqual([item]);
    expect(recorded.movements).toEqual([]);
  });

  it('records opening stock as an adjustment in the same transaction', async () => {
    const { recorded, dependencies } = harness();

    const item = await addInventoryItem(
      CLINIC,
      {
        name: ' Lidocaine 2% ',
        sku: ' LIDO-2 ',
        description: '  Cartridges  ',
        unit: ' box ',
        openingStock: 12,
        minStock: 4,
        costMinor: 8_000,
      },
      dependencies,
    );

    expect(item).toMatchObject({
      name: 'Lidocaine 2%',
      sku: 'LIDO-2',
      description: 'Cartridges',
      unit: 'box',
      stock: 12,
      minStock: 4,
      costMinor: 8_000,
    });
    expect(recorded.movements).toEqual([
      {
        id: MOVEMENT,
        itemId: NEW_ITEM,
        type: 'ADJUSTMENT',
        quantity: 12,
        unitCostMinor: 8_000,
        reference: 'Opening stock',
        notes: null,
        performedAt: NOW,
      },
    ]);
  });

  it('refuses a blank name, a fractional count and a negative cost', async () => {
    const { dependencies } = harness();

    await expect(addInventoryItem(CLINIC, { name: '   ' }, dependencies)).rejects.toThrowError(
      /needs a name/,
    );
    await expect(
      addInventoryItem(CLINIC, { name: 'Gauze', openingStock: 1.5 }, dependencies),
    ).rejects.toThrowError(/whole number/);
    await expect(
      addInventoryItem(CLINIC, { name: 'Gauze', costMinor: -1 }, dependencies),
    ).rejects.toThrowError(/zero or more/);
  });

  it('scopes the write to the clinic on the request', async () => {
    const { recorded, dependencies } = harness();

    await addInventoryItem(OTHER_CLINIC, { name: 'Gauze' }, dependencies);

    expect(recorded.items[0]?.clinicId).toBe(OTHER_CLINIC);
  });
});

describe('recordStockMovement', () => {
  it('writes the ledger row and the new level together', async () => {
    const { recorded, dependencies } = harness({ stored: anItem() });

    const result = await recordStockMovement(
      CLINIC,
      ITEM,
      { type: 'USAGE', quantity: 4, reference: ' Visit 42 ' },
      dependencies,
    );

    expect(result.item.stock).toBe(6);
    expect(result.movement).toEqual({
      id: MOVEMENT,
      itemId: ITEM,
      type: 'USAGE',
      quantity: 4,
      unitCostMinor: null,
      reference: 'Visit 42',
      notes: null,
      performedAt: NOW,
    });
    expect(recorded.movements).toEqual([result.movement]);
    expect(recorded.stockWrites).toEqual([{ clinicId: CLINIC, itemId: ITEM, stock: 6 }]);
  });

  it('reads the item in the request clinic, and refuses a missing one before writing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      recordStockMovement(CLINIC, ITEM, { type: 'PURCHASE', quantity: 2 }, dependencies),
    ).rejects.toThrowError(/was not found/);

    expect(recorded.reads).toEqual([{ clinicId: CLINIC, itemId: ITEM }]);
    expect(recorded.movements).toEqual([]);
    expect(recorded.stockWrites).toEqual([]);
  });

  it('refuses over-use and writes neither the movement nor the level', async () => {
    const { recorded, dependencies } = harness({ stored: anItem({ stock: 2 }) });

    await expect(
      recordStockMovement(CLINIC, ITEM, { type: 'USAGE', quantity: 3 }, dependencies),
    ).rejects.toThrowError(/Not enough stock/);

    expect(recorded.movements).toEqual([]);
    expect(recorded.stockWrites).toEqual([]);
  });

  it('refuses a malformed quantity before reading the item', async () => {
    const { recorded, dependencies } = harness({ stored: anItem() });

    await expect(
      recordStockMovement(CLINIC, ITEM, { type: 'USAGE', quantity: 0 }, dependencies),
    ).rejects.toThrowError(/positive integer/);

    expect(recorded.reads).toEqual([]);
  });
});
