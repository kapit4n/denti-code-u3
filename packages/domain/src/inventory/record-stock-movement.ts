/**
 * Recording a stock movement — the only way an item's level changes after it is
 * created.
 *
 * The item is read inside the transaction, the domain applies the type's
 * direction, and then two writes land together: the append-only movement row and
 * the item's cached stock. A movement that was written without moving the count
 * (or the count without the movement) would make the two books disagree, which is
 * the one failure the ledger exists to prevent.
 *
 * A missing item — including one in another clinic — is `NOT_FOUND` before
 * anything is written. An outflow larger than the stock on hand is
 * `INSUFFICIENT_STOCK`, raised by `applyStockMovement`; the endpoint maps it to a
 * 409, so the desk is told it cannot use what it does not have.
 */
import type { ClinicId, InventoryItemId } from '@denti-code-u3/types';

import type { UnitOfWork } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import {
  applyStockMovement,
  STOCK_MOVEMENT_TYPES,
  type InventoryItem,
  type StockMovement,
  type StockMovementType,
} from './inventory.js';

/** What the request may say about one movement. */
export interface NewStockMovement {
  readonly type: StockMovementType;
  /** Always positive; the type decides whether stock rises or falls. */
  readonly quantity: number;
  readonly unitCostMinor?: number | null;
  readonly reference?: string | null;
  readonly notes?: string | null;
}

export interface RecordStockMovementDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly newMovementId: () => string;
  readonly clock: Clock;
}

const MAX_INTEGER = 2_147_483_647;

export interface RecordedStockMovement {
  readonly item: InventoryItem;
  readonly movement: StockMovement;
}

/**
 * Apply one movement to one item, writing the ledger row and the new level.
 */
export async function recordStockMovement(
  clinicId: ClinicId,
  itemId: InventoryItemId,
  input: NewStockMovement,
  dependencies: RecordStockMovementDependencies,
): Promise<RecordedStockMovement> {
  if (!STOCK_MOVEMENT_TYPES.includes(input.type)) {
    throw new DomainError('INVALID_INPUT', 'Unknown stock movement type', { type: input.type });
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new DomainError('INVALID_INPUT', 'Stock movement quantity must be a positive integer', {
      field: 'quantity',
      quantity: input.quantity,
    });
  }

  const unitCostMinor = input.unitCostMinor ?? null;
  if (
    unitCostMinor !== null &&
    (!Number.isInteger(unitCostMinor) || unitCostMinor < 0 || unitCostMinor > MAX_INTEGER)
  ) {
    throw new DomainError(
      'INVALID_INPUT',
      'The unit cost must be whole minor units, zero or more',
      {
        field: 'unitCostMinor',
      },
    );
  }

  const reference = input.reference?.trim() || null;
  if (reference !== null && reference.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The reference is too long', { field: 'reference' });
  }

  const notes = input.notes?.trim() || null;
  if (notes !== null && notes.length > 2_000) {
    throw new DomainError('INVALID_INPUT', 'The notes are too long', { field: 'notes' });
  }

  return dependencies.unitOfWork.transaction(async ({ inventory }) => {
    const current = await inventory.findById(clinicId, itemId);

    if (!current) {
      throw new DomainError('NOT_FOUND', `Item ${itemId} was not found`, {
        entity: 'InventoryItem',
        id: itemId,
      });
    }

    // The domain's own rule: a positive integer, an outflow that cannot go below
    // zero, and the direction named by the type rather than by a sign.
    const next = applyStockMovement(current, input.type, input.quantity);

    const movement: StockMovement = {
      id: dependencies.newMovementId(),
      itemId,
      type: input.type,
      quantity: input.quantity,
      unitCostMinor,
      reference,
      notes,
      performedAt: dependencies.clock.now(),
    };

    await inventory.addMovement(movement);
    await inventory.updateStock(clinicId, itemId, next.stock);

    return { item: next, movement };
  });
}
