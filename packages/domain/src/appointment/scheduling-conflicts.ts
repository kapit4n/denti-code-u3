import type { ChairId, DentistId, IsoDateTime } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';
import { intervalsOverlap } from '../shared/time.js';
import type { Appointment } from './appointment.js';
import { computeAppointmentEnd } from './appointment.js';
import { reservesSchedulingSlot } from './appointment-lifecycle.js';

/** A resource that can only host one appointment at a time. */
export interface ScheduleResource {
  readonly dentistId: DentistId;
  readonly chairId?: ChairId;
}

export interface ScheduleConflict {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly dentistId: DentistId;
  readonly chairId?: ChairId;
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
}

/**
 * Find every appointment that would overlap `candidate`.
 *
 * The domain performs the *overlap arithmetic*; the repository supplies the
 * rows. That split is deliberate: the rule is a pure function and therefore
 * testable without a database, while the data access stays in infrastructure.
 *
 * A cancelled or no-show appointment releases its slot, so it never conflicts;
 * a scheduled or confirmed appointment does, because the chair is reserved.
 */
export function findSchedulingConflicts(
  candidate: Appointment,
  existing: readonly Appointment[],
): ScheduleConflict[] {
  const candidateEnd = computeAppointmentEnd(candidate);
  const candidateResources = resourcesOf(candidate);

  return existing
    .filter((appointment) => appointment.id !== candidate.id)
    .filter((appointment) => reservesSchedulingSlot(appointment.status))
    .filter((appointment) =>
      intervalsOverlap(
        candidate.startsAt,
        candidateEnd,
        appointment.startsAt,
        computeAppointmentEnd(appointment),
      ),
    )
    .filter((appointment) =>
      resourcesOf(appointment).some((resource) => candidateResources.includes(resource)),
    )
    .map((appointment) => ({
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      dentistId: appointment.dentistId,
      ...(appointment.chairId ? { chairId: appointment.chairId } : {}),
      startsAt: appointment.startsAt,
      endsAt: computeAppointmentEnd(appointment),
    }));
}

export function assertNoSchedulingConflicts(
  candidate: Appointment,
  existing: readonly Appointment[],
): void {
  const conflicts = findSchedulingConflicts(candidate, existing);
  if (conflicts.length > 0) {
    throw new DomainError(
      'SCHEDULING_CONFLICT',
      `The appointment overlaps ${conflicts.length} existing appointment(s)`,
      { conflicts },
    );
  }
}

function resourcesOf(appointment: Appointment): string[] {
  return [
    `dentist:${appointment.dentistId}`,
    ...(appointment.chairId ? [`chair:${appointment.chairId}`] : []),
  ];
}
