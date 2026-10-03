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
 * When an appointment ends.
 *
 * Exists separately from `computeAppointmentEnd` because a reader often has the
 * two values that decide the answer and not a whole appointment — the agenda has
 * a row with no dentist attached. Without this, that reader has to fabricate an
 * entity to call the entity-shaped function, and a fabricated `dentistId` is a
 * lie sitting in the middle of a calculation.
 *
 * The database computes the same thing in `appointment_ends_at()`, declared
 * IMMUTABLE so the exclusion constraints can use it. Two implementations of one
 * rule is unavoidable across a language boundary; they are asserted against each
 * other in the integration tests.
 */
export function appointmentEndsAt(startsAt: IsoDateTime, durationMinutes: number): IsoDateTime {
  return addMinutes(startsAt, durationMinutes);
}

/**
 * `endsAt` is always computed, never stored: a stored end time can disagree with
 * a changed start or duration, and the agenda would then show two truths.
 */
export function computeAppointmentEnd(appointment: Appointment): IsoDateTime {
  return appointmentEndsAt(appointment.startsAt, appointment.durationMinutes);
}

export function isValidAppointmentDuration(durationMinutes: number): boolean {
  return (
    Number.isInteger(durationMinutes) &&
    durationMinutes >= MINIMUM_APPOINTMENT_MINUTES &&
    durationMinutes <= MAXIMUM_APPOINTMENT_MINUTES
  );
}
