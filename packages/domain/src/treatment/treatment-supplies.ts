/**
 * Supplies consumed by a treatment recorded on a visit.
 *
 * A supply is a clinical fact (what the treatment used) and an inventory fact (what
 * left the shelf). The two are written in one transaction: the supply row, the
 * `USAGE` movement in the append-only ledger, and the item's cached stock level.
 * Writing only one of them would make the treatment and the inventory disagree.
 *
 * The table has no clinic column of its own. Tenancy comes through the treatment
 * execution, which belongs to a visit; the read joins that chain, and the write
 * resolves the visit and the record in this clinic before it touches stock.
 */
import type {
  ClinicId,
  InventoryItemId,
  IsoDateTime,
  VisitId,
  VisitTreatmentExecutionId,
  VisitTreatmentSupplyId,
} from '@denti-code-u3/types';

import type { InventoryItem, StockMovement } from '../inventory/index.js';
import { applyStockMovement } from '../inventory/index.js';
import type { UnitOfWork } from '../ports/index.js';
import type { TreatmentSupplyRepository, VisitRepository } from '../ports/index.js';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import { getVisit } from '../visit/visit-read.js';

/** One supply line linked to the treatment that used it. */
export interface TreatmentSupply {
  readonly id: VisitTreatmentSupplyId;
  readonly treatmentRecordId: VisitTreatmentExecutionId;
  readonly itemId: InventoryItemId;
  readonly quantity: number;
  readonly recordedAt: IsoDateTime;
}

/** The body a caller may send: what was used, and how much. */
export interface NewTreatmentSupply {
  readonly itemId: InventoryItemId;
  readonly quantity: number;
}

export interface TreatmentSupplyReadDependencies {
  readonly visits: VisitRepository;
  readonly treatmentSupplies: TreatmentSupplyRepository;
}

export interface TreatmentSupplyWriteDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly newSupplyId: () => VisitTreatmentSupplyId;
  readonly newMovementId: () => string;
}

export interface RecordedTreatmentSupply {
  readonly supply: TreatmentSupply;
  readonly item: InventoryItem;
  readonly movement: StockMovement;
}

const MAX_INTEGER = 2_147_483_647;

/** Every supply recorded on one visit, oldest first. */
export async function listTreatmentSupplies(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: TreatmentSupplyReadDependencies,
): Promise<readonly TreatmentSupply[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.treatmentSupplies.findForVisit(clinicId, visitId);
}

/**
 * Consume stock for one recorded treatment.
 *
 * The quantity is always positive; `USAGE` names the direction. The rule that an
 * outflow cannot take stock below zero lives in `applyStockMovement`, the same rule
 * every inventory movement uses. The supply row, movement and cached stock are
 * written together, so a failure leaves none of them behind.
 */
export async function recordTreatmentSupply(
  clinicId: ClinicId,
  visitId: VisitId,
  treatmentRecordId: VisitTreatmentExecutionId,
  input: NewTreatmentSupply,
  dependencies: TreatmentSupplyWriteDependencies,
): Promise<RecordedTreatmentSupply> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > MAX_INTEGER) {
    throw new DomainError('INVALID_INPUT', 'Supply quantity must be a positive integer', {
      field: 'quantity',
      quantity: input.quantity,
    });
  }

  return dependencies.unitOfWork.transaction(
    async ({ visits, treatmentRecords, treatmentSupplies, inventory }) => {
      const visit = await visits.findById(clinicId, visitId);

      if (!visit) {
        throw notFound('Visit', visitId);
      }

      const records = await treatmentRecords.findForVisit(clinicId, visitId);
      const record = records.find((candidate) => candidate.id === treatmentRecordId);

      if (!record) {
        throw notFound('TreatmentRecord', treatmentRecordId);
      }

      const current = await inventory.findById(clinicId, input.itemId);

      if (!current) {
        throw notFound('InventoryItem', input.itemId);
      }

      const next = applyStockMovement(current, 'USAGE', input.quantity);
      const recordedAt = dependencies.clock.now();

      const supply: TreatmentSupply = {
        id: dependencies.newSupplyId(),
        treatmentRecordId: record.id,
        itemId: input.itemId,
        quantity: input.quantity,
        recordedAt,
      };

      const movement: StockMovement = {
        id: dependencies.newMovementId(),
        itemId: input.itemId,
        type: 'USAGE',
        quantity: input.quantity,
        unitCostMinor: null,
        reference: `Treatment ${record.id}`,
        notes: null,
        performedAt: recordedAt,
      };

      await treatmentSupplies.add(supply);
      await inventory.addMovement(movement);
      await inventory.updateStock(clinicId, input.itemId, next.stock);

      return { supply, item: next, movement };
    },
  );
}
