/**
 * Recording supplies against a treatment.
 *
 * The decisions worth pinning:
 *
 *  - **Tenancy comes through the visit.** The supply table has no clinic column, so a
 *    foreign visit or a record that is not on this visit is `NOT_FOUND`, and nothing
 *    is written.
 *  - **The stock rule is inventory's, not a second copy.** `USAGE` takes stock out,
 *    and an outflow larger than the shelf is `INSUFFICIENT_STOCK`; the supply row, the
 *    ledger row and the cached level are either all written or none is.
 *  - **The body only names an item and a quantity.** The type is `USAGE`, the time is
 *    the clock's, and the ids are the generator's.
 */
import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asDentistId,
  asInventoryItemId,
  asPatientId,
  asTreatmentId,
  asVisitId,
  asVisitTreatmentExecutionId,
  asVisitTreatmentSupplyId,
  type ClinicId,
  type InventoryItemId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type {
  InventoryRepository,
  Repositories,
  TreatmentRecordRepository,
  TreatmentSupplyRepository,
  UnitOfWork,
  VisitRepository,
} from '../ports/index.js';
import type { InventoryItem, StockMovement } from '../inventory/index.js';
import type { Visit } from '../visit/index.js';
import type { TreatmentRecord, TreatmentSupply } from './index.js';
import { listTreatmentSupplies, recordTreatmentSupply } from './treatment-supplies.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const TREATMENT = asTreatmentId('44444444-4444-4444-8444-444444444444');
const RECORD = asVisitTreatmentExecutionId('55555555-5555-4555-8555-555555555558');
const OTHER_RECORD = asVisitTreatmentExecutionId('55555555-5555-4555-8555-555555555559');
const ITEM = asInventoryItemId('77777777-7777-4777-8777-777777777777');
const SUPPLY = asVisitTreatmentSupplyId('88888888-8888-4888-8888-888888888888');
const MOVEMENT = '99999999-9999-4999-8999-999999999999';
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

function aRecord(overrides: Partial<TreatmentRecord> = {}): TreatmentRecord {
  return {
    id: RECORD,
    visitId: VISIT,
    treatmentId: TREATMENT,
    tooth: '36',
    notes: null,
    performedAt: NOW,
    endedAt: null,
    treatmentPlanItemId: null,
    ...overrides,
  };
}

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
  readonly supplies: TreatmentSupply[];
  readonly movements: StockMovement[];
  readonly stockWrites: { clinicId: ClinicId; itemId: InventoryItemId; stock: number }[];
  readonly recordReads: { clinicId: ClinicId; visitId: VisitId }[];
  readonly supplyReads: { clinicId: ClinicId; visitId: VisitId }[];
}

function harness(
  options: {
    visit?: Visit;
    records?: readonly TreatmentRecord[];
    item?: InventoryItem;
    supplies?: readonly TreatmentSupply[];
  } = {},
) {
  const recorded: Recorded = {
    supplies: [],
    movements: [],
    stockWrites: [],
    recordReads: [],
    supplyReads: [],
  };
  const visit = 'visit' in options ? options.visit : openVisit();
  const records = options.records ?? [aRecord()];
  const item = 'item' in options ? options.item : anItem();
  const supplies = options.supplies ?? [];

  const visits: VisitRepository = {
    findById: async (clinicId, visitId) =>
      visit && visit.id === visitId && visit.clinicId === clinicId ? visit : undefined,
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    listForClinic: async () => ({ items: [], total: 0 }),
    updateStatus: async () => {},
    save: async () => {},
  };

  const treatmentRecords: TreatmentRecordRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.recordReads.push({ clinicId, visitId });
      return records;
    },
    save: async () => {},
    finish: async () => {},
  };

  const inventory: InventoryRepository = {
    listByClinic: async () => (item ? [item] : []),
    findById: async (_clinicId, itemId) => (item?.id === itemId ? item : undefined),
    add: async () => {},
    updateStock: async (clinicId, itemId, stock) => {
      recorded.stockWrites.push({ clinicId, itemId, stock });
    },
    addMovement: async (movement) => {
      recorded.movements.push(movement);
    },
    listMovements: async () => recorded.movements,
  };

  const treatmentSupplies: TreatmentSupplyRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.supplyReads.push({ clinicId, visitId });
      return supplies;
    },
    add: async (supply) => {
      recorded.supplies.push(supply);
    },
  };

  const unitOfWork: UnitOfWork = {
    transaction: async (work) =>
      work({ visits, treatmentRecords, treatmentSupplies, inventory } as unknown as Repositories),
  };

  return {
    recorded,
    readDependencies: { visits, treatmentSupplies },
    writeDependencies: {
      unitOfWork,
      clock: { now: () => NOW },
      newSupplyId: () => SUPPLY,
      newMovementId: () => MOVEMENT,
    },
  };
}

describe('recordTreatmentSupply', () => {
  it('writes the supply, the USAGE movement and the new stock in one pass', async () => {
    const { recorded, writeDependencies } = harness();

    const result = await recordTreatmentSupply(
      CLINIC,
      VISIT,
      RECORD,
      { itemId: ITEM, quantity: 3 },
      writeDependencies,
    );

    expect(result.supply).toEqual({
      id: SUPPLY,
      treatmentRecordId: RECORD,
      itemId: ITEM,
      quantity: 3,
      recordedAt: NOW,
    });
    expect(result.item.stock).toBe(7);
    expect(recorded.supplies).toEqual([result.supply]);
    expect(recorded.movements).toEqual([
      {
        id: MOVEMENT,
        itemId: ITEM,
        type: 'USAGE',
        quantity: 3,
        unitCostMinor: null,
        reference: `Treatment ${RECORD}`,
        notes: null,
        performedAt: NOW,
      },
    ]);
    expect(recorded.stockWrites).toEqual([{ clinicId: CLINIC, itemId: ITEM, stock: 7 }]);
  });

  it('refuses a quantity that is not a positive integer before opening the transaction', async () => {
    const { recorded, writeDependencies } = harness();

    for (const quantity of [0, -2, 1.5]) {
      await expect(
        recordTreatmentSupply(CLINIC, VISIT, RECORD, { itemId: ITEM, quantity }, writeDependencies),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }

    expect(recorded.supplies).toEqual([]);
    expect(recorded.movements).toEqual([]);
    expect(recorded.stockWrites).toEqual([]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, and writes nothing', async () => {
    const { recorded, writeDependencies } = harness();

    await expect(
      recordTreatmentSupply(
        OTHER_CLINIC,
        VISIT,
        RECORD,
        { itemId: ITEM, quantity: 1 },
        writeDependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.supplies).toEqual([]);
  });

  it('answers NOT_FOUND for a record that is not on this visit, and writes nothing', async () => {
    const { recorded, writeDependencies } = harness();

    await expect(
      recordTreatmentSupply(
        CLINIC,
        VISIT,
        OTHER_RECORD,
        { itemId: ITEM, quantity: 1 },
        writeDependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.supplies).toEqual([]);
  });

  it('answers NOT_FOUND for an item this clinic does not hold, and writes nothing', async () => {
    const { recorded, writeDependencies } = harness({ item: undefined });

    await expect(
      recordTreatmentSupply(
        CLINIC,
        VISIT,
        RECORD,
        { itemId: ITEM, quantity: 1 },
        writeDependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.supplies).toEqual([]);
  });

  it('refuses more than the stock on hand and leaves the ledger and the shelf alone', async () => {
    const { recorded, writeDependencies } = harness({ item: anItem({ stock: 2 }) });

    await expect(
      recordTreatmentSupply(
        CLINIC,
        VISIT,
        RECORD,
        { itemId: ITEM, quantity: 3 },
        writeDependencies,
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(recorded.supplies).toEqual([]);
    expect(recorded.movements).toEqual([]);
    expect(recorded.stockWrites).toEqual([]);
  });
});

describe('listTreatmentSupplies', () => {
  it('returns what the repository holds after checking the visit', async () => {
    const supply: TreatmentSupply = {
      id: SUPPLY,
      treatmentRecordId: RECORD,
      itemId: ITEM,
      quantity: 2,
      recordedAt: NOW,
    };
    const { recorded, readDependencies } = harness({ supplies: [supply] });

    const list = await listTreatmentSupplies(CLINIC, VISIT, readDependencies);

    expect(list).toEqual([supply]);
    expect(recorded.supplyReads).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a foreign visit instead of an empty list', async () => {
    const { recorded, readDependencies } = harness();

    await expect(
      listTreatmentSupplies(OTHER_CLINIC, VISIT, readDependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.supplyReads).toEqual([]);
  });
});
