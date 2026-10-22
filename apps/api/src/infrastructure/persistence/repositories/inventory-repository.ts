/**
 * Inventory persistence, on PostgreSQL.
 *
 * Items carry their own `clinic_id`, so the list and the single read scope on the
 * row itself. Movements do not: they belong to an item, and the item's clinic is
 * the tenant — so `listMovements` joins `inventory_items` and filters the clinic
 * there, the same shape the clinical books use for rows that inherit tenancy
 * (ADR 0014).
 *
 * The cached `stock` column is written by `updateStock` with the value the domain
 * computed. Nothing here adds a delta: a repository that decided direction would
 * be a second place the movement's type is interpreted, and the ledger and the
 * cached level could then disagree.
 *
 * A duplicate SKU is refused by the `(clinic_id, sku)` unique index and translated
 * to `DUPLICATED_RECORD`; an item with no SKU stores `null` and is not constrained
 * by the index.
 */
import {
  DomainError,
  type InventoryItem,
  type InventoryRepository,
  type StockMovement,
  type StockMovementType,
} from '@denti-code-u3/domain';
import {
  asInventoryItemId,
  type ClinicId,
  type InventoryItemId,
  type IsoDateTime,
} from '@denti-code-u3/types';
import { and, asc, desc, eq } from 'drizzle-orm';

import { inventoryItems, stockMovements } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isUniqueViolation } from '../postgres-error.js';

const ITEM_COLUMNS = {
  id: inventoryItems.id,
  clinicId: inventoryItems.clinicId,
  name: inventoryItems.name,
  sku: inventoryItems.sku,
  description: inventoryItems.description,
  unit: inventoryItems.unit,
  stock: inventoryItems.stock,
  minStock: inventoryItems.minStock,
  costMinor: inventoryItems.costMinor,
  isActive: inventoryItems.isActive,
} as const;

const MOVEMENT_COLUMNS = {
  id: stockMovements.id,
  itemId: stockMovements.itemId,
  type: stockMovements.type,
  quantity: stockMovements.quantity,
  unitCostMinor: stockMovements.unitCostMinor,
  reference: stockMovements.reference,
  notes: stockMovements.notes,
  performedAt: stockMovements.performedAt,
} as const;

export class DrizzleInventoryRepository implements InventoryRepository {
  constructor(private readonly db: DentiDatabase) {}

  async listByClinic(clinicId: ClinicId): Promise<readonly InventoryItem[]> {
    const rows = await this.db
      .select(ITEM_COLUMNS)
      .from(inventoryItems)
      .where(eq(inventoryItems.clinicId, clinicId))
      .orderBy(asc(inventoryItems.name), asc(inventoryItems.id));

    return rows.map(toItem);
  }

  async findById(clinicId: ClinicId, itemId: InventoryItemId): Promise<InventoryItem | undefined> {
    const [row] = await this.db
      .select(ITEM_COLUMNS)
      .from(inventoryItems)
      .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, itemId)))
      .limit(1);

    return row ? toItem(row) : undefined;
  }

  async add(clinicId: ClinicId, item: InventoryItem): Promise<void> {
    try {
      await this.db.insert(inventoryItems).values({
        id: item.id,
        clinicId,
        name: item.name,
        sku: item.sku,
        description: item.description,
        unit: item.unit,
        stock: item.stock,
        minStock: item.minStock,
        costMinor: item.costMinor,
        isActive: item.isActive,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('DUPLICATED_RECORD', 'That SKU is already in the inventory', {
          field: 'sku',
        });
      }
      throw error;
    }
  }

  async updateStock(clinicId: ClinicId, itemId: InventoryItemId, stock: number): Promise<void> {
    await this.db
      .update(inventoryItems)
      .set({ stock, updatedAt: new Date() })
      .where(and(eq(inventoryItems.clinicId, clinicId), eq(inventoryItems.id, itemId)));
  }

  async addMovement(movement: StockMovement): Promise<void> {
    await this.db.insert(stockMovements).values({
      id: movement.id,
      itemId: movement.itemId,
      type: movement.type,
      quantity: movement.quantity,
      unitCostMinor: movement.unitCostMinor,
      reference: movement.reference,
      notes: movement.notes,
      performedAt: new Date(movement.performedAt),
    });
  }

  async listMovements(
    clinicId: ClinicId,
    itemId: InventoryItemId,
  ): Promise<readonly StockMovement[]> {
    const rows = await this.db
      .select(MOVEMENT_COLUMNS)
      .from(stockMovements)
      .innerJoin(inventoryItems, eq(inventoryItems.id, stockMovements.itemId))
      .where(and(eq(inventoryItems.clinicId, clinicId), eq(stockMovements.itemId, itemId)))
      .orderBy(desc(stockMovements.performedAt), desc(stockMovements.id));

    return rows.map(toMovement);
  }
}

function toItem(row: {
  id: string;
  clinicId: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  stock: number;
  minStock: number;
  costMinor: number;
  isActive: boolean;
}): InventoryItem {
  return {
    id: asInventoryItemId(row.id),
    clinicId: row.clinicId as ClinicId,
    name: row.name,
    sku: row.sku,
    description: row.description,
    unit: row.unit,
    stock: row.stock,
    minStock: row.minStock,
    costMinor: row.costMinor,
    isActive: row.isActive,
  };
}

function toMovement(row: {
  id: string;
  itemId: string;
  type: StockMovementType;
  quantity: number;
  unitCostMinor: number | null;
  reference: string | null;
  notes: string | null;
  performedAt: Date;
}): StockMovement {
  return {
    id: row.id,
    itemId: asInventoryItemId(row.itemId),
    type: row.type,
    quantity: row.quantity,
    unitCostMinor: row.unitCostMinor,
    reference: row.reference,
    notes: row.notes,
    performedAt: row.performedAt.toISOString() as IsoDateTime,
  };
}
