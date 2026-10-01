import type {
  DentistId,
  IsoDateTime,
  PatientId,
  PrescriptionId,
  VisitId,
} from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

export const MEDICATION_ROUTES = [
  'ORAL',
  'TOPICAL',
  'INHALATION',
  'INJECTION',
  'RECTAL',
  'OTHER',
] as const;

export type MedicationRoute = (typeof MEDICATION_ROUTES)[number];

export interface Prescription {
  readonly id: PrescriptionId;
  readonly visitId: VisitId;
  readonly patientId: PatientId;
  readonly dentistId: DentistId;
  readonly issuedAt: IsoDateTime;
  readonly medication: string;
  readonly dosage: string;
  readonly route: MedicationRoute;
  readonly frequency: string;
  readonly durationDays: number;
  readonly instructions?: string;
}

export function assertValidPrescription(prescription: Prescription): void {
  if (!prescription.medication.trim()) {
    throw new DomainError('INVALID_INPUT', 'A prescription must name a medication', {
      prescriptionId: prescription.id,
    });
  }
  if (prescription.durationDays <= 0) {
    throw new DomainError('INVALID_INPUT', 'Prescription duration must be at least one day', {
      prescriptionId: prescription.id,
      durationDays: prescription.durationDays,
    });
  }
}
