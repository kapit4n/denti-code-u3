/**
 * Treatment-supply persistence, on SQLite — the twin of
 * `repositories/treatment-supply-repository.ts` (ADR 0025).
 *
 * The same visit join for tenancy, the same append-only write and the same translated
 * foreign-key refusal. The differences are the engine's: the SQLite schema entry
 * point, synchronous reads, and `SQLITE_CONSTRAINT_FOREIGNKEY` standing in for
 * PostgreSQL's `23503`.
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
} from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

const SUPPLY_COLUMNS = {
  id: visitTreatmentSupplies.id,
  treatmentRecordId: visitTreatmentSupplies.treatmentRecordId,
  itemId: visitTreatmentSupplies.itemId,
  quantity: visitTreatmentSupplies.quantity,
  recordedAt: visitTreatmentSupplies.recordedAt,
} as const;

export class SQLiteTreatmentSupplyRepository implements TreatmentSupplyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly TreatmentSupply[]> {
    const rows = this.db
      .select(SUPPLY_COLUMNS)
      .from(visitTreatmentSupplies)
      .innerJoin(
        visitTreatmentExecutions,
        eq(visitTreatmentExecutions.id, visitTreatmentSupplies.treatmentRecordId),
      )
      .innerJoin(visits, eq(visits.id, visitTreatmentExecutions.visitId))
      .where(and(eq(visitTreatmentExecutions.visitId, visitId), eq(visits.clinicId, clinicId)))
      .orderBy(asc(visitTreatmentSupplies.recordedAt), asc(visitTreatmentSupplies.id))
      .all();

    return rows.map(toEntity);
  }

  async add(supply: TreatmentSupply): Promise<void> {
    try {
      this.db
        .insert(visitTreatmentSupplies)
        .values({
          id: supply.id,
          treatmentRecordId: supply.treatmentRecordId,
          itemId: supply.itemId,
          quantity: supply.quantity,
          recordedAt: new Date(supply.recordedAt),
        })
        .run();
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
