/**
 * Prescription persistence, on SQLite — the twin of
 * `repositories/prescription-repository.ts` (ADR 0025).
 *
 * The join that scopes `findForVisit` to one clinic, the translated foreign-key
 * refusal in `save`, and the `issued_at, id` ordering are the same file: the only
 * differences here are the engine's — the schema entry point, the synchronous `.run()`
 * this driver needs for an insert to happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY`
 * standing in for PostgreSQL's `23503`.
 */
import { DomainError, type Prescription, type PrescriptionRepository } from '@denti-code-u3/domain';
import {
  asDentistId,
  asPatientId,
  asPrescriptionId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { prescriptions, visits } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

const PRESCRIPTION_COLUMNS = {
  id: prescriptions.id,
  visitId: prescriptions.visitId,
  patientId: prescriptions.patientId,
  dentistId: prescriptions.dentistId,
  medication: prescriptions.medication,
  dosage: prescriptions.dosage,
  route: prescriptions.route,
  frequency: prescriptions.frequency,
  durationDays: prescriptions.durationDays,
  instructions: prescriptions.instructions,
  issuedAt: prescriptions.issuedAt,
} as const;

export class SQLitePrescriptionRepository implements PrescriptionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Prescription[]> {
    const rows = await this.db
      .select(PRESCRIPTION_COLUMNS)
      .from(prescriptions)
      .innerJoin(visits, eq(visits.id, prescriptions.visitId))
      .where(and(eq(prescriptions.visitId, visitId), eq(visits.clinicId, clinicId)))
      .orderBy(asc(prescriptions.issuedAt), asc(prescriptions.id));

    return rows.map(toEntity);
  }

  async save(prescription: Prescription): Promise<void> {
    try {
      this.db
        .insert(prescriptions)
        .values({
          id: prescription.id,
          visitId: prescription.visitId,
          patientId: prescription.patientId,
          dentistId: prescription.dentistId,
          medication: prescription.medication,
          dosage: prescription.dosage,
          route: prescription.route,
          frequency: prescription.frequency,
          durationDays: prescription.durationDays,
          instructions: prescription.instructions,
          issuedAt: new Date(prescription.issuedAt),
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${prescription.visitId} was not found`, {
          entity: 'Visit',
          id: prescription.visitId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }
}

function toEntity(row: {
  id: string;
  visitId: string;
  patientId: string;
  dentistId: string | null;
  medication: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  instructions: string | null;
  issuedAt: Date;
}): Prescription {
  return {
    id: asPrescriptionId(row.id),
    visitId: asVisitId(row.visitId),
    patientId: asPatientId(row.patientId),
    // Null is a fact about the row, not an absent field: the visit has no clinician.
    dentistId: row.dentistId ? asDentistId(row.dentistId) : null,
    medication: row.medication,
    dosage: row.dosage,
    route: row.route as Prescription['route'],
    frequency: row.frequency,
    durationDays: row.durationDays,
    instructions: row.instructions,
    issuedAt: row.issuedAt.toISOString() as IsoDateTime,
  };
}
