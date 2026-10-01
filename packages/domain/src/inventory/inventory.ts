import type { InventoryItemId } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE',
  'USAGE',
  'ADJUSTMENT',
  'RETURN',
  'EXPIRED',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface InventoryItem {
  readonly id: InventoryItemId;
  readonly clinicId: string;
  readonly name: string;
  readonly sku?: string;
  readonly unit: string;
  readonly stock: number;
  readonly minStock: number;
  readonly costMinor: number;
  readonly isActive: boolean;
}

export function isLowStock(item: InventoryItem): boolean {
  return item.stock <= item.minStock;
}

export function applyStockMovement(
  item: InventoryItem,
  type: StockMovementType,
  quantity: number,
): InventoryItem {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new DomainError('INVALID_INPUT', 'Stock movement quantity must be a positive integer', {
      quantity,
    });
  }
  const nextStock = type === 'USAGE' ? item.stock - quantity : item.stock + quantity;
  if (nextStock < 0) {
    throw new DomainError('INSUFFICIENT_STOCK', `Not enough stock for ${item.name}`, {
      itemId: item.id,
      available: item.stock,
      requested: quantity,
    });
  }
  return { ...item, stock: nextStock };
}
