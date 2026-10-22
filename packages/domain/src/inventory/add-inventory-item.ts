/**
 * Adding an item to the clinic's inventory.
 *
 * An inventory item is a catalogue row like a treatment: the clinic names it,
 * counts it in its own unit, and sets the minimum it must keep. The id, the
 * clock and the opening ledger row belong to the server.
 *
 * **Opening stock is a movement, not a bare number.** When an item arrives with
 * stock already on the shelf, that stock did not appear from nowhere: it is
 * written as an `ADJUSTMENT` movement in the same transaction as the item. That
 * keeps the cached `stock` column and the ledger in agreement from the first
 * read, which is the property every later movement depends on. An item created
 * with zero stock writes no movement, because zero is the absence of stock, not
 * an event.
 *
 * `sku` is optional and unique per clinic. The unique index is the only place
 * two concurrent writers are both visible, so a duplicate is refused there and
 * translated to `DUPLICATED_RECORD` by the repositories, not pre-checked here.
 */
import type { ClinicId, InventoryItemId } from '@denti-code-u3/types';

import type { UnitOfWork } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import type { InventoryItem } from './inventory.js';

/** What the request may say about a new item. */
export interface NewInventoryItem {
  readonly name: string;
  readonly sku?: string | null;
  readonly description?: string | null;
  /** The unit stock is counted in; defaults to `unit`. */
  readonly unit?: string;
  /** Stock already on the shelf when the item is created. */
  readonly openingStock?: number;
  readonly minStock?: number;
  /** Cost per unit in minor units of the clinic currency. */
  readonly costMinor?: number;
}

export interface AddInventoryItemDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly newItemId: () => InventoryItemId;
  readonly newMovementId: () => string;
  readonly clock: Clock;
}

const MAX_INTEGER = 2_147_483_647;

function wholeNumber(value: number, field: string, message: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_INTEGER) {
    throw new DomainError('INVALID_INPUT', message, { field });
  }
  return value;
}

/**
 * Add one item to the clinic's inventory, with its opening stock on the ledger.
 */
export async function addInventoryItem(
  clinicId: ClinicId,
  input: NewInventoryItem,
  dependencies: AddInventoryItemDependencies,
): Promise<InventoryItem> {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new DomainError('INVALID_INPUT', 'An inventory item needs a name', { field: 'name' });
  }
  if (name.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The item name is too long', { field: 'name' });
  }

  const sku = input.sku?.trim() || null;
  if (sku !== null && sku.length > 50) {
    throw new DomainError('INVALID_INPUT', 'The SKU is too long', { field: 'sku' });
  }

  const description = input.description?.trim() || null;
  if (description !== null && description.length > 2_000) {
    throw new DomainError('INVALID_INPUT', 'The description is too long', {
      field: 'description',
    });
  }

  const unit = input.unit?.trim() || 'unit';
  if (unit.length > 50) {
    throw new DomainError('INVALID_INPUT', 'The unit is too long', { field: 'unit' });
  }

  const openingStock = wholeNumber(
    input.openingStock ?? 0,
    'openingStock',
    'Opening stock must be a whole number, zero or more',
  );
  const minStock = wholeNumber(
    input.minStock ?? 0,
    'minStock',
    'Minimum stock must be a whole number, zero or more',
  );
  const costMinor = wholeNumber(
    input.costMinor ?? 0,
    'costMinor',
    'The unit cost must be a whole number of minor units, zero or more',
  );

  const item: InventoryItem = {
    id: dependencies.newItemId(),
    clinicId,
    name,
    sku,
    description,
    unit,
    stock: openingStock,
    minStock,
    costMinor,
    isActive: true,
  };

  await dependencies.unitOfWork.transaction(async ({ inventory }) => {
    await inventory.add(clinicId, item);

    if (openingStock > 0) {
      await inventory.addMovement({
        id: dependencies.newMovementId(),
        itemId: item.id,
        type: 'ADJUSTMENT',
        quantity: openingStock,
        unitCostMinor: costMinor,
        reference: 'Opening stock',
        notes: null,
        performedAt: dependencies.clock.now(),
      });
    }
  });

  return item;
}
