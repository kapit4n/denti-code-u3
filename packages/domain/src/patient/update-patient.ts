import type { ClinicId, IsoDate, PatientId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import type { PatientWriteRepository } from '../ports/index.js';
import {
  editablePatientDetailsFrom,
  type PatientDetailsInput,
} from './editable-patient-details.js';

/**
 * Editing a patient.
 *
 * The counterpart to `registerPatient`, and deliberately almost the same: it
 * checks and normalises the same details, and hands the result to a repository
 * that scopes the write to one clinic.
 *
 * What it does *not* do is read the patient first. Everything an edit may change
 * arrives in the request, so a single `UPDATE` is enough. Reading the row to merge
 * into would add a round trip and, worse, a window in which two people editing the
 * same patient overwrite each other's changes without either being told.
 *
 * An absent optional field means "this patient does not have one", not "leave the
 * existing value". That is what lets a receptionist clear an email that was
 * recorded in error; a merge would make clearing impossible.
 */

export type UpdatePatientInput = PatientDetailsInput;

export interface UpdatePatientDependencies {
  readonly patients: PatientWriteRepository;
  readonly clock: Clock;
}

/**
 * Apply an edit.
 *
 * Returns false when the clinic holds no patient with that id — which is also the
 * answer for a patient belonging to another clinic, and the answer the caller
 * needs to report rather than a hint that the id exists somewhere.
 */
export async function updatePatient(
  clinicId: ClinicId,
  patientId: PatientId,
  input: UpdatePatientInput,
  { patients, clock }: UpdatePatientDependencies,
): Promise<boolean> {
  const details = editablePatientDetailsFrom(input, clock.now().slice(0, 10) as IsoDate);

  // The clinic scope is part of the `WHERE` clause, not a check that happened
  // earlier: a patient id is a uuid, and "look it up in my clinic, then write to
  // it" as two steps is exactly the shape of a cross-tenant write (ADR 0014).
  return patients.update(clinicId, patientId, details);
}
