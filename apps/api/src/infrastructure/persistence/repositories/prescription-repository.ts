/**
 * Prescription persistence, on PostgreSQL.
 *
 * Prescriptions are a clinical record's third companion: like `clinical_notes`, the
 * table has no `clinic_id`, so the two decisions this file makes are the same ones
 * the note repository makes, for the same reasons (ADR 0014):
 *
 *  - **`findForVisit` takes a clinic and joins `visits` to use it.** A read has no use
 *    case in front of it to resolve the visit first (the repository *is* the read), so
 *    the scoping has to live in the statement — a prescription row on its own cannot
 *    tell which clinic owns it.
 *  - **`save` takes no clinic, because the use case already read the visit in this
 *    clinic.** What `save` cannot know is whether that visit still exists, so the one
 *    refusal it translates is the foreign key: a visit deleted between the read and
 *    the insert answers `NOT_FOUND` rather than a `23503` reaching the API as a 500.
 *
 * Order is `issued_at` ascending with the id as a tiebreak: two prescriptions handed
 * over in the same millisecond still have a stable reading order, and a course of
 * medication that shuffles between reads is worse than one with an
 * arbitrary-but-fixed order.
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

import { prescriptions, visits } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

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

export class DrizzlePrescriptionRepository implements PrescriptionRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      await this.db.insert(prescriptions).values({
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
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${prescription.visitId} was not found`, {
          entity: 'Visit',
          id: prescription.visitId,
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
