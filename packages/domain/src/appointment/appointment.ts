import type {
  AppointmentId,
  ChairId,
  ClinicId,
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
  /**
   * The clinic whose book this belongs to. Branded rather than `string`, so an
   * appointment cannot be written for a clinic that was never named — the
   * alternative is a plain id that any caller can assemble by accident
   * (ADR 0014).
   */
  readonly clinicId: ClinicId;
  readonly patientId: PatientId;
  /**
   * Null once the dentist leaves the clinic: the column is `on delete set null`.
   *
   * Nullability is stated here because a booking really can outlive its dentist,
   * and the alternative — typing it as always present — forces every reader to
   * either lie (invent an id) or ignore the column. A `null` dentist holds no
   * dentist resource, so such an appointment can only ever conflict on its chair.
   *
   * A *new* appointment is different: `createAppointment` requires a dentist,
   * because a booking nobody is going to perform is not a booking.
   */
  readonly dentistId: DentistId | null;
  /**
   * The column is here because the entity is a picture of the table, not because
   * anything books into it: `AgendaEntry` does not report a room, so
   * `createAppointment` does not accept one and `rescheduleAppointment` cannot move
   * one. A chair belongs to a room, so `room_no_overlap` still bites through the
   * chair (ADR 0018).
   */
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
