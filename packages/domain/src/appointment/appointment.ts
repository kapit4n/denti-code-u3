import type {
  AppointmentId,
  ChairId,
  DentistId,
  IsoDateTime,
  PatientId,
  TreatmentId,
} from '@denti-code-u3/types';
import type { AppointmentStatus } from './appointment-status.js';
import { addMinutes } from '../shared/time.js';

/** Minutes of the shortest appointment the clinic accepts. */
export const MINIMUM_APPOINTMENT_MINUTES = 5;

/** Longest appointment that may be scheduled in a single block. */
export const MAXIMUM_APPOINTMENT_MINUTES = 8 * 60;

export interface Appointment {
  readonly id: AppointmentId;
  readonly clinicId: string;
  readonly patientId: PatientId;
  readonly dentistId: DentistId;
  readonly roomId?: string;
  readonly chairId?: ChairId;
  /** Instant the appointment begins, stored in UTC. */
  readonly startsAt: IsoDateTime;
  readonly durationMinutes: number;
  readonly status: AppointmentStatus;
  readonly treatmentId?: TreatmentId;
  readonly visitId?: string;
  readonly notes?: string;
  readonly cancelledReason?: string;
}

/**
 * `endsAt` is always computed, never stored: a stored end time can disagree with
 * a changed start or duration, and the agenda would then show two truths.
 */
export function computeAppointmentEnd(appointment: Appointment): IsoDateTime {
  return addMinutes(appointment.startsAt, appointment.durationMinutes);
}

export function isValidAppointmentDuration(durationMinutes: number): boolean {
  return (
    Number.isInteger(durationMinutes) &&
    durationMinutes >= MINIMUM_APPOINTMENT_MINUTES &&
    durationMinutes <= MAXIMUM_APPOINTMENT_MINUTES
  );
}
