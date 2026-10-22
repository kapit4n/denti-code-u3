/**
 * Inventory: the clinic's consumable stock.
 *
 * Two books, one rule. An `InventoryItem` is what the clinic keeps — its unit,
 * its cost, the minimum it must not fall below. A `StockMovement` is one thing
 * that happened to it: bought, used, returned, expired, counted. The item's
 * `stock` is the cached projection of its movements; the movement ledger is the
 * record that can be audited.
 *
 * **Direction lives in the type, not in the sign.** A movement's quantity is
 * always a positive integer, so a ledger row can never be read two ways. `USAGE`
 * and `EXPIRED` take stock out; `PURCHASE`, `RETURN` and `ADJUSTMENT` put it in.
 * An adjustment downward is an `EXPIRED` or a usage correction, not a negative
 * `ADJUSTMENT`: a negative quantity in this table would make "how much moved"
 * and "which way" one field, and every reader would have to remember the sign.
 *
 * This is a foundation rule, not a full stock-control policy. Transfers between
 * locations, batches, lot numbers and expiry-driven depletion are not modelled
 * yet; when they are, they get their own ADR rather than a sixth movement type
 * with an overloaded meaning.
 */
import type { ClinicId, InventoryItemId, IsoDateTime } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE',
  'USAGE',
  'ADJUSTMENT',
  'RETURN',
  'EXPIRED',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** The two movement types that take stock out of the clinic. */
const OUTBOUND_STOCK_MOVEMENT_TYPES: ReadonlySet<StockMovementType> = new Set(['USAGE', 'EXPIRED']);

/** Whether a movement of this type decreases the item's stock. */
export function isStockOutflow(type: StockMovementType): boolean {
  return OUTBOUND_STOCK_MOVEMENT_TYPES.has(type);
}

/** One item the clinic keeps in stock. */
export interface InventoryItem {
  readonly id: InventoryItemId;
  readonly clinicId: ClinicId;
  readonly name: string;
  /** The clinic's own code for the item; unique per clinic when present. */
  readonly sku: string | null;
  readonly description: string | null;
  /** The unit stock is counted in: `unit`, `box`, `ml`, `pair`… */
  readonly unit: string;
  /** Cached projection of the movement ledger, updated in the same transaction. */
  readonly stock: number;
  readonly minStock: number;
  /** Cost per unit in minor units of the clinic currency. */
  readonly costMinor: number;
  readonly isActive: boolean;
}

/** One row of the append-only stock ledger. */
export interface StockMovement {
  readonly id: string;
  readonly itemId: InventoryItemId;
  readonly type: StockMovementType;
  /** Always positive; `type` decides the direction. */
  readonly quantity: number;
  readonly unitCostMinor: number | null;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly performedAt: IsoDateTime;
}

/** An item is low when its stock is at or below the minimum it must keep. */
export function isLowStock(item: Pick<InventoryItem, 'stock' | 'minStock'>): boolean {
  return item.stock <= item.minStock;
}

/**
 * Apply one movement to an item and return the item with its new stock.
 *
 * The rule is all here: quantity is a positive integer, and an outflow that would
 * take the item below zero is refused rather than clamped. A clamped stock is a
 * stock that hides a discrepancy; a refusal is the clinic being told it used
 * something it does not have.
 */
export function applyStockMovement(
  item: InventoryItem,
  type: StockMovementType,
  quantity: number,
): InventoryItem {
  if (!STOCK_MOVEMENT_TYPES.includes(type)) {
    throw new DomainError('INVALID_INPUT', 'Unknown stock movement type', { type });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new DomainError('INVALID_INPUT', 'Stock movement quantity must be a positive integer', {
      field: 'quantity',
      quantity,
    });
  }

  const nextStock = isStockOutflow(type) ? item.stock - quantity : item.stock + quantity;

  if (nextStock < 0) {
    throw new DomainError('INSUFFICIENT_STOCK', `Not enough stock for ${item.name}`, {
      itemId: item.id,
      available: item.stock,
      requested: quantity,
    });
  }

  return { ...item, stock: nextStock };
}
