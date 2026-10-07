import type {
  DentistId,
  IsoDateTime,
  PatientId,
  PrescriptionId,
  VisitId,
} from '@denti-code-u3/types';

/**
 * The routes a medication can be taken by, as the column holds them and the
 * workspace labels them. The boundary schema mirrors these as literal strings
 * (`medicationRouteSchema`) so validation never imports the domain (validation
 * is a self-contained mirror, exactly as appointment statuses were first got there).
 */
export const MEDICATION_ROUTES = [
  'ORAL',
  'TOPICAL',
  'INHALATION',
  'INJECTION',
  'RECTAL',
  'OTHER',
] as const;

export type MedicationRoute = (typeof MEDICATION_ROUTES)[number];

/**
 * One prescription, as the table holds it.
 *
 * The entity is the write's contract: the clinic that scopes it, the visit it names,
 * the patient and dentist it inherits (never restated), and the course. `instructions`
 * is `null` when none were given — a blank instruction is dropped, not stored empty,
 * so the record can tell "no instruction" and "nothing instructed" apart.
 */
export interface Prescription {
  readonly id: PrescriptionId;
  readonly visitId: VisitId;
  readonly patientId: PatientId;
  /** Null when the visit has no clinician; the column is `on delete set null`. */
  readonly dentistId: DentistId | null;
  readonly issuedAt: IsoDateTime;
  readonly medication: string;
  readonly dosage: string;
  readonly route: MedicationRoute;
  readonly frequency: string;
  readonly durationDays: number;
  readonly instructions: string | null;
}
