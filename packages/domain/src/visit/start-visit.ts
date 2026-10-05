/**
 * Starting a visit — the one door a clinical encounter comes in through.
 *
 * The rules are not here. They are in `visit-lifecycle.ts`, as pure functions that
 * take an appointment and return the visit and the appointment it becomes, which is
 * what made them testable in Milestone 1 without a database. This file's whole job is
 * the part a pure function cannot do: read the appointment, and write two rows so that
 * neither exists without the other.
 *
 * **Why a transaction, stated once.** The bridge writes a `visits` row *and* moves its
 * `appointments` row to `IN_TREATMENT` with `visit_id` set. Written separately there is
 * a state with no correct reading — a visit whose booking has not noticed, which puts
 * a treated patient back in the waiting list — and no amount of retrying repairs it,
 * because the repair is itself the write that was refused. So both go through one
 * `UnitOfWork`, which is the seam the domain declared for exactly this (ADR 0021).
 *
 * **Why not an operation-shaped port** such as `createFromAppointment(visit,
 * appointment)` on a visit repository. It would be smaller, and it would put the
 * transaction inside a persistence class where transactions usually live. It also
 * could not be composed: billing needs to write a visit, its charges and its payment
 * in one transaction, and this seam is the one that will serve that.
 *
 * **What this use case deliberately does not do.** It does not check that the patient
 * is still active, that the appointment is in the future, or that the clinic is open —
 * those are questions about the booking, and the booking was already asked them when it
 * was made. A visit started from a booking that happened three weeks ago is a late
 * arrival, not an invalid request, and refusing it here would mean the clinic could not
 * record the treatment it actually performed.
 */
import type { AppointmentId, ClinicId, VisitId } from '@denti-code-u3/types';

import { notFound } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import type { UnitOfWork } from '../ports/index.js';
import { startVisitFromAppointment, type StartedVisit, type Visit } from './visit-lifecycle.js';

/**
 * What starting a visit needs from the outside world.
 *
 * Three dependencies and no repository: the repositories arrive *inside* the
 * transaction, which is the point of taking a `UnitOfWork` rather than the two
 * repositories directly. A use case that could be handed `visits` and `appointments`
 * separately would be one refactor away from writing them in two transactions.
 */
export interface StartVisitDependencies {
  readonly unitOfWork: UnitOfWork;
  /** The id the new visit is written under, allocated inside the transaction. */
  readonly newId: () => VisitId;
  /**
   * When treatment started.
   *
   * The appointment's own start time is *not* used, and the difference is a decision:
   * a booking is when the patient was due and a visit is when they were actually seen,
   * which for a running-late clinic is routinely a different hour. Using the booking's
   * time would make every late visit look punctual in the record.
   */
  readonly clock: Clock;
}

/**
 * Start a visit from an appointment.
 *
 * Answers with the visit and the appointment as the database now holds them, so a
 * client can replace its cached agenda row rather than reconstruct one — the same
 * reason every appointment write answers with the row rather than the request.
 *
 * A booking this clinic does not hold is `NOT_FOUND`, not a validation failure. That
 * covers another clinic's appointment too, and saying so would leak that the id
 * exists somewhere.
 */
export async function startVisit(
  clinicId: ClinicId,
  appointmentId: AppointmentId,
  dependencies: StartVisitDependencies,
): Promise<StartedVisit> {
  return dependencies.unitOfWork.transaction(async (repositories) => {
    const appointment = await repositories.appointments.findById(clinicId, appointmentId);

    if (!appointment) {
      throw notFound('Appointment', appointmentId);
    }

    // The id is allocated only after the read, and a refusal further down still burns
    // one — the same promise `createAppointment` makes about identifiers, and for the
    // same reason: a booking that cannot happen should not consume a number that a real
    // visit will need. It cannot be deferred past `startVisitFromAppointment`, which
    // takes the id as an argument, so what this can guarantee is the narrower and
    // honest one — a booking this clinic does not hold consumes none.
    const visitId = dependencies.newId();

    // The instant comes from the clock rather than the request, so a client cannot file
    // a visit that started last Tuesday or next month.
    const started: StartedVisit = startVisitFromAppointment(
      appointment,
      visitId,
      dependencies.clock.now(),
    );

    // Visit first. The appointment's `visit_id` has a foreign key to the row the next
    // line writes, so the other order is a constraint violation rather than a race —
    // and this one is also the order the pure function hands them back in.
    await repositories.visits.save(started.visit);

    const moved = await repositories.appointments.becomeVisit(
      clinicId,
      appointmentId,
      started.visit.id,
      started.appointment.status,
    );

    if (!moved) {
      // The booking was deleted between the read above and this write. `restrict` on
      // `visits.appointment_id` would have refused the insert first, so reaching here
      // means the two statements disagreed about which rows exist — and the honest
      // answer is the same 404 rather than a visit attached to nothing.
      throw notFound('Appointment', appointmentId);
    }

    return { visit: started.visit, appointment: moved };
  });
}

/** What a caller gets back: the visit, and the appointment it became. */
export type { StartedVisit };

/** Re-exported so a client of `startVisit` need not import the lifecycle to name a visit. */
export type { Visit };
