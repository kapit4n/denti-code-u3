/**
 * Treatment-supply persistence, on PostgreSQL.
 *
 * `visit_treatment_supplies` has no `clinic_id`: it belongs to a treatment record,
 * which belongs to a visit. The read follows that chain and filters the visit's
 * clinic there; the write trusts the use case, which has already read the visit and
 * the record in this clinic before it writes.
 *
 * A supply is a fact of what was used, not a stock level. The stock movement and the
 * item's cached quantity are written by `InventoryRepository` in the same
 * transaction, so this repository only appends the line.
 */
import {
  DomainError,
  type TreatmentSupply,
  type TreatmentSupplyRepository,
} from '@denti-code-u3/domain';
import {
  asInventoryItemId,
  asVisitTreatmentExecutionId,
  asVisitTreatmentSupplyId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import {
  visitTreatmentExecutions,
  visitTreatmentSupplies,
  visits,
} from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

const SUPPLY_COLUMNS = {
  id: visitTreatmentSupplies.id,
  treatmentRecordId: visitTreatmentSupplies.treatmentRecordId,
  itemId: visitTreatmentSupplies.itemId,
  quantity: visitTreatmentSupplies.quantity,
  recordedAt: visitTreatmentSupplies.recordedAt,
} as const;

export class DrizzleTreatmentSupplyRepository implements TreatmentSupplyRepository {
  constructor(private readonly db: DentiDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly TreatmentSupply[]> {
    const rows = await this.db
      .select(SUPPLY_COLUMNS)
      .from(visitTreatmentSupplies)
      .innerJoin(
        visitTreatmentExecutions,
        eq(visitTreatmentExecutions.id, visitTreatmentSupplies.treatmentRecordId),
      )
      .innerJoin(visits, eq(visits.id, visitTreatmentExecutions.visitId))
      .where(and(eq(visitTreatmentExecutions.visitId, visitId), eq(visits.clinicId, clinicId)))
      .orderBy(asc(visitTreatmentSupplies.recordedAt), asc(visitTreatmentSupplies.id));

    return rows.map(toEntity);
  }

  async add(supply: TreatmentSupply): Promise<void> {
    try {
      await this.db.insert(visitTreatmentSupplies).values({
        id: supply.id,
        treatmentRecordId: supply.treatmentRecordId,
        itemId: supply.itemId,
        quantity: supply.quantity,
        recordedAt: new Date(supply.recordedAt),
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError(
          'INVALID_INPUT',
          'That treatment record or inventory item is no longer available',
          { treatmentRecordId: supply.treatmentRecordId, itemId: supply.itemId },
        );
      }
      throw error;
    }
  }
}

function toEntity(row: {
  id: string;
  treatmentRecordId: string;
  itemId: string;
  quantity: number;
  recordedAt: Date;
}): TreatmentSupply {
  return {
    id: asVisitTreatmentSupplyId(row.id),
    treatmentRecordId: asVisitTreatmentExecutionId(row.treatmentRecordId),
    itemId: asInventoryItemId(row.itemId),
    quantity: row.quantity,
    recordedAt: row.recordedAt.toISOString() as IsoDateTime,
  };
}
