/**
 * The prescriptions written on a visit — the smallest whole slice of the
 * workspace's "prescriptions" section.
 *
 * **A prescription has no clinic of its own, and that is a fact rather than a
 * shortcut.** `prescriptions` carries `visit_id` and no `clinic_id`, exactly like
 * `clinical_notes` and `visit_treatment_executions`, so the visit the prescription
 * names *is* the tenant key (ADR 0014). Both use cases read the visit first — the
 * read is what decides whether this clinic may see or write the prescription, and
 * one for another clinic's visit is `NOT_FOUND`, indistinguishable from a visit that
 * does not exist. The repository's `findForVisit` re-scopes through a join for the
 * same reason, defence in depth on a read (ADR 0014).
 *
 * **Who the row names is inherited, never restated.** `patient_id` and `dentist_id`
 * come from the visit, not from the request: a client must not tell a clinic who — or
 * whose clinician — a record is about, because the subject is the visit. The request
 * body therefore carries only the medication and its course. `dentistId` is nullable
 * on the entity for the same reason it is nullable on the visit and in the column
 * (`on delete set null`): a visit can be open with no clinician, and a prescription
 * does not need one to be a fact about the treatment the patient was sent home with.
 *
 * **`issuedAt` is the clinic's clock**, the same hand that stamps a note's `createdAt`
 * and a record's `performedAt`: nothing about *when* happened is a client's to say.
 * The order a reader sees is `issued_at` then id, the chronological hand-offs of a
 * course of medication, decided by the repository for the same reason the patient
 * timeline's order is (ADR 0023).
 *
 * **Reading *then* writing, and no `UnitOfWork`.** A foreign visit must answer 404
 * before anything is inserted, so the refusal arrives as a domain error rather than
 * as a foreign-key violation translated afterwards; and once the visit is proven,
 * one row, one statement — ceremony is a unit of work around a single insert.
 */
import type { ClinicId, PrescriptionId, VisitId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { PrescriptionRepository, VisitRepository } from '../ports/index.js';
import { getVisit } from '../visit/visit-read.js';
import type { MedicationRoute, Prescription } from './prescription.js';

/** A prescription is not its own subject: the visit scopes both uses. */
export interface PrescriptionReadDependencies {
  readonly visits: VisitRepository;
  readonly prescriptions: PrescriptionRepository;
}

/** A write adds the two things only a writer knows: whose clock, and what id. */
export interface PrescriptionWriteDependencies extends PrescriptionReadDependencies {
  readonly clock: Clock;
  readonly newId: () => PrescriptionId;
}

/** The body a caller hands to the write use case, in domain terms. */
export interface NewPrescription {
  readonly medication: string;
  readonly dosage: string;
  readonly route: MedicationRoute;
  readonly frequency: string;
  readonly durationDays: number;
  readonly instructions?: string | null;
}

/**
 * Every prescription on one visit, in the order they were handed over — the order a
 * reader of a course of medication expects, and the repository's to decide (ADR 0023).
 *
 * 404 for a visit this clinic does not hold, and `[]` only for a visit that does.
 * This is the subject-shaped read of `getVisit`, not the subject-less list of
 * `listVisitsForPatient`: prescriptions belong to a visit, so the visit has to be
 * there before its prescriptions can be an empty truth.
 */
export async function listVisitPrescriptions(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: PrescriptionReadDependencies,
): Promise<readonly Prescription[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.prescriptions.findForVisit(clinicId, visitId);
}

/**
 * Prescribe a medication on a visit this clinic holds.
 *
 * **The order is the whole contract**: the visit first (the subject — a foreign visit
 * is `NOT_FOUND`), then each field of the course judged on its own, and only then the
 * insert. `patientId` and `dentistId` are copied from the visit, never taken from the
 * request; `issuedAt` is stamped by the clock; and the id comes from the caller's
 * generator — the same division of labour every write here has, so a test can hold
 * both still.
 *
 * Blank free text is `INVALID_INPUT` rather than a stored empty row ("a medication
 * needs a name"), because the schema refuses it at the boundary with a sentence a
 * client can show and this refusal is the rule itself. A blank `instructions` is
 * dropped to `null`, not stored empty: an empty string is a field that was typed and
 * then forgotten, and a prescription that cannot see the difference between "no
 * instruction" and "nothing instructed" is lying about both.
 */
export async function addVisitPrescription(
  clinicId: ClinicId,
  visitId: VisitId,
  input: NewPrescription,
  dependencies: PrescriptionWriteDependencies,
): Promise<Prescription> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const medication = input.medication.trim();

  if (!medication) {
    throw new DomainError('INVALID_INPUT', 'A medication needs a name', { visitId });
  }

  if (medication.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The medication name is too long', {
      medication,
    });
  }

  const dosage = input.dosage.trim();

  if (!dosage) {
    throw new DomainError('INVALID_INPUT', 'A prescription needs a dosage', { visitId });
  }

  if (dosage.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The dosage is too long', { dosage });
  }

  const frequency = input.frequency.trim();

  if (!frequency) {
    throw new DomainError('INVALID_INPUT', 'A prescription needs a frequency', {
      visitId,
    });
  }

  if (frequency.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The frequency is too long', { frequency });
  }

  if (!Number.isInteger(input.durationDays) || input.durationDays < 1) {
    throw new DomainError('INVALID_INPUT', 'A prescription needs a whole-day course', {
      durationDays: input.durationDays,
    });
  }

  if (input.durationDays > 365) {
    throw new DomainError('INVALID_INPUT', 'A course longer than a year is not a course', {
      durationDays: input.durationDays,
    });
  }

  const instructions = input.instructions?.trim() || null;

  if (instructions && instructions.length > 2_000) {
    throw new DomainError('INVALID_INPUT', 'The instructions are too long', {
      instructions,
    });
  }

  const prescription: Prescription = {
    id: dependencies.newId(),
    visitId,
    patientId: visit.patientId,
    dentistId: visit.dentistId,
    medication,
    dosage,
    route: input.route,
    frequency,
    durationDays: input.durationDays,
    instructions,
    issuedAt: dependencies.clock.now(),
  };

  await dependencies.prescriptions.save(prescription);

  return prescription;
}
