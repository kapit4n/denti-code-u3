/**
 * Treatment-record persistence, on PostgreSQL.
 *
 * The twin of `clinical-note-repository.ts` in shape, and its argument is the same:
 * `visit_treatment_executions` has no `clinic_id`, so every line follows from that
 * one fact.
 *
 *  - **`findForVisit` takes a clinic and joins `visits` to use it.** A read has no use
 *    case in front of it to resolve the visit first (the repository *is* the read), so
 *    the scoping lives in the statement — a record row on its own cannot tell which
 *    clinic owns it (ADR 0014).
 *  - **`save` takes no clinic, because the use case already read both the visit and the
 *    treatment in this clinic.** What `save` cannot know is whether the treatment still
 *    exists, so the one refusal it translates is the foreign key: a treatment deleted
 *    between the read and the insert answers the same `INVALID_INPUT` the read would
 *    have given, rather than a `23503` reaching the API as a 500. The record's visit is
 *    `on delete cascade`, so the row cannot outlive its visit in either direction.
 *
 * Order is `performed_at` ascending with the id as a tiebreak, the same stable reading
 * order a clinical record gets: two treatments performed in the same millisecond still
 * read in a fixed sequence, and a record that shuffles between reads is worse than one
 * with an arbitrary-but-fixed order.
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

import { visitTreatmentExecutions, visits } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

const RECORD_COLUMNS = {
  id: visitTreatmentExecutions.id,
  visitId: visitTreatmentExecutions.visitId,
  treatmentId: visitTreatmentExecutions.treatmentId,
  tooth: visitTreatmentExecutions.tooth,
  notes: visitTreatmentExecutions.notes,
  performedAt: visitTreatmentExecutions.performedAt,
} as const;

export class DrizzleTreatmentRecordRepository implements TreatmentRecordRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      await this.db.insert(visitTreatmentExecutions).values({
        id: record.id,
        visitId: record.visitId,
        treatmentId: record.treatmentId,
        tooth: record.tooth,
        notes: record.notes,
        performedAt: new Date(record.performedAt),
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError(
          'INVALID_INPUT',
          'That treatment is not in this clinic\u2019s catalogue',
          { treatmentId: record.treatmentId },
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
