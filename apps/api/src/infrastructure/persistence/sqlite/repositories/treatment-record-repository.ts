/**
 * Treatment-record persistence, on SQLite — the twin of
 * `repositories/treatment-record-repository.ts` (ADR 0025).
 *
 * The join that scopes `findForVisit` to one clinic, the translated foreign-key
 * refusal in `save`, and the `performed_at, id` ordering are the same file: the only
 * differences here are the engine's — the schema entry point, the synchronous `.run()`
 * this driver needs for an insert to happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY`
 * standing in for PostgreSQL's `23503`.
 */
import {
  DomainError,
  type TreatmentRecord,
  type TreatmentRecordRepository,
} from '@denti-code-u3/domain';
import {
  asTreatmentId,
  asVisitId,
  asVisitTreatmentExecutionId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { visitTreatmentExecutions, visits } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

const RECORD_COLUMNS = {
  id: visitTreatmentExecutions.id,
  visitId: visitTreatmentExecutions.visitId,
  treatmentId: visitTreatmentExecutions.treatmentId,
  tooth: visitTreatmentExecutions.tooth,
  notes: visitTreatmentExecutions.notes,
  performedAt: visitTreatmentExecutions.performedAt,
} as const;

export class SQLiteTreatmentRecordRepository implements TreatmentRecordRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly TreatmentRecord[]> {
    const rows = await this.db
      .select(RECORD_COLUMNS)
      .from(visitTreatmentExecutions)
      .innerJoin(visits, eq(visits.id, visitTreatmentExecutions.visitId))
      .where(and(eq(visitTreatmentExecutions.visitId, visitId), eq(visits.clinicId, clinicId)))
      .orderBy(asc(visitTreatmentExecutions.performedAt), asc(visitTreatmentExecutions.id));

    return rows.map(toEntity);
  }

  async save(record: TreatmentRecord): Promise<void> {
    try {
      this.db
        .insert(visitTreatmentExecutions)
        .values({
          id: record.id,
          visitId: record.visitId,
          treatmentId: record.treatmentId,
          tooth: record.tooth,
          notes: record.notes,
          performedAt: new Date(record.performedAt),
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError(
          'INVALID_INPUT',
          'That treatment is not in this clinic\u2019s catalogue',
          { treatmentId: record.treatmentId, sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY' },
        );
      }
      throw error;
    }
  }
}

function toEntity(row: {
  id: string;
  visitId: string;
  treatmentId: string;
  tooth: string | null;
  notes: string | null;
  performedAt: Date;
}): TreatmentRecord {
  return {
    id: asVisitTreatmentExecutionId(row.id),
    visitId: asVisitId(row.visitId),
    treatmentId: asTreatmentId(row.treatmentId),
    tooth: row.tooth,
    notes: row.notes,
    performedAt: row.performedAt.toISOString() as IsoDateTime,
  };
}
