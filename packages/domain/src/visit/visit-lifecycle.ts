import type { Appointment, AppointmentStatus } from '../appointment/index.js';
import type {
  AppointmentId,
  DentistId,
  IsoDateTime,
  PatientId,
  VisitId,
} from '@denti-code-u3/types';
import { DomainError, illegalTransition } from '../shared/errors.js';
import type { VisitStatus } from './visit-status.js';

export interface Visit {
  readonly id: VisitId;
  readonly clinicId: string;
  readonly patientId: PatientId;
  /**
   * The clinician who treated, or `null` once they have left the clinic.
   *
   * Nullable because the column is `on delete set null` and a visit outlives the
   * employment that produced it — and refusing to _start_ a visit without a
   * clinician is a separate rule, checked by `startVisitFromAppointment`. Creation
   * requires one; reading a visit whose clinician has since departed does not, because
   * the alternative is a type that insists on a name the database has already
   * forgotten (ADR 0021).
   */
  readonly dentistId: DentistId | null;
  readonly appointmentId?: AppointmentId;
  readonly chairId?: string;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly status: VisitStatus;
  readonly summary?: string;
}

const ALLOWED_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  OPEN: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['OPEN'],
  CANCELLED: [],
};

export function allowedVisitTransitions(from: VisitStatus): readonly VisitStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionVisit(from: VisitStatus, to: VisitStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertVisitTransition(from: VisitStatus, to: VisitStatus): void {
  if (!canTransitionVisit(from, to)) {
    throw illegalTransition('Visit', from, to);
  }
}

/** Only an open visit may accept new clinical records. */
export function acceptsClinicalRecords(visit: Visit): boolean {
  return visit.status === 'OPEN';
}

export function assertAcceptsClinicalRecords(visit: Visit): void {
  if (!acceptsClinicalRecords(visit)) {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `A ${visit.status.toLowerCase()} visit no longer accepts clinical records`,
      { visitId: visit.id, status: visit.status },
    );
  }
}

/** The appointment status that means "the patient is now being treated". */
export const APPOINTMENT_STATUS_WHEN_VISIT_STARTS: AppointmentStatus = 'IN_TREATMENT';

export interface StartedVisit {
  readonly visit: Visit;
  readonly appointment: Appointment;
}

/**
 * The single legal bridge from scheduling to clinical.
 *
 * The visit is created from the appointment and linked back to it, and the
 * appointment moves to `IN_TREATMENT` — so the agenda and the clinical record
 * can never disagree about whether the patient is being treated.
 *
 * This function is pure: it returns the new state rather than persisting it, so
 * the use case controls the transaction.
 */
export function startVisitFromAppointment(
  appointment: Appointment,
  visitId: VisitId,
  startedAt: IsoDateTime,
): StartedVisit {
  if (appointment.status === 'COMPLETED') {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      'A completed appointment cannot start a new visit',
      { appointmentId: appointment.id, status: appointment.status },
    );
  }

  // A visit is attributable to a clinician, and an appointment whose dentist has
  // left the clinic has none — the column went to null with the row it referenced.
  // Refusing is the honest answer: inventing a dentist for the record would put a
  // name on treatment that somebody else may have performed.
  if (appointment.dentistId === null) {
    throw new DomainError(
      'INVALID_INPUT',
      'This appointment has no dentist, so it cannot start a visit',
      { appointmentId: appointment.id },
    );
  }

  if (appointment.visitId) {
    throw new DomainError(
      'DUPLICATED_RECORD',
      'This appointment already has a visit; an appointment becomes a visit exactly once',
      { appointmentId: appointment.id, visitId: appointment.visitId },
    );
  }

  return {
    visit: {
      id: visitId,
      clinicId: appointment.clinicId,
      patientId: appointment.patientId,
      dentistId: appointment.dentistId,
      appointmentId: appointment.id,
      ...(appointment.chairId ? { chairId: appointment.chairId } : {}),
      startedAt,
      status: 'OPEN',
    },
    appointment: {
      ...appointment,
      status: APPOINTMENT_STATUS_WHEN_VISIT_STARTS,
      visitId,
    },
  };
}

/**
 * Close a visit. A visit may only be completed once it has started.
 *
 * `endedAt` is the time the clinician finished, which is not the same as the time the
 * row was written — a visit closed at the end of a long appointment and saved at the
 * desk afterwards has an end time long before its `updated_at`.
 */
/**
 * A completed visit, which by definition has an end time.
 *
 * `Visit.endedAt` is optional because a visit that has not finished has none, so the
 * base type cannot promise it. This intersection can, and it earns its place: the
 * caller that persists the result writes `ended_at` from it, and without the refinement
 * that call needs a `??` that would quietly write null for a visit the domain has just
 * declared finished.
 */
export interface CompletedVisit extends Visit {
  readonly endedAt: IsoDateTime;
}

export function completeVisit(visit: Visit, endedAt: IsoDateTime): CompletedVisit {
  assertVisitTransition(visit.status, 'COMPLETED');
  if (!visit.startedAt) {
    throw new DomainError('INVALID_INPUT', 'A visit must have started before it can be completed', {
      visitId: visit.id,
    });
  }
  return { ...visit, status: 'COMPLETED', endedAt };
}

/**
 * Re-open a closed visit, because clinicians amend records.
 *
 * **No timestamp argument, and that is the correction.** This function used to take
 * `reopenedAt` and return an entity that never mentioned it — the parameter was
 * accepted and discarded, and the unit test that passed it a literal was asserting that
 * the discard still happened. There is no column that could hold "when this was
 * re-opened", and adding one nothing reads is the fault ADR 0018 removed `treatmentId`
 * for. `updated_at` moves with the write and is the whole trace, until reopening
 * becomes auditable — which needs a person to attribute it to, and there is no user
 * model yet (ADR 0022).
 */
export function reopenVisit(visit: Visit): Visit {
  assertVisitTransition(visit.status, 'OPEN');
  return { ...visit, status: 'OPEN', endedAt: undefined };
}
