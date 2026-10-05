/**
 * The two ways a visit ends, and the one way it starts again.
 *
 * Session 23 built the bridge (`start-visit.ts`) and left these two pure functions
 * sitting in `visit-lifecycle.ts` with no caller, so every visit the clinic started
 * stayed `OPEN` forever. This file is the other half of the lifecycle, and it is
 * shaped like `appointment-write.ts` for a reason worth stating: both use cases are
 * read-evaluate-write over **one** row, with no second row to keep in step.
 *
 * **No `UnitOfWork` here, deliberately.** `startVisit` is handed a transaction because
 * it writes a visit *and* moves an appointment, and a seam that can be handed two
 * repositories is one refactor away from writing them separately (ADR 0021). Neither
 * use case here writes anything else, so a transaction would be ceremony around one
 * statement — and the read exists only to evaluate a transition rule, not to decide
 * between two writes. The status and its end time always travel together in that one
 * statement, so a concurrent complete and reopen can only overwrite each other's
 * intent; neither can leave a completed visit with no end time.
 *
 * **Neither use case touches the appointment**, and that is a decision with a price
 * rather than an oversight — see ADR 0022. The short version: an appointment is terminal
 * once `COMPLETED`, so a visit that completed its own appointment could never be
 * re-opened without adding a `COMPLETED → IN_TREATMENT` edge that would appear as a
 * button on every completed appointment in the clinic.
 *
 * No body, no reason and no summary, because no product question has asked for any.
 * `visits.summary` exists and the patient profile reads it; requiring one here would be
 * inventing a requirement, and accepting one would be a field nothing consumes yet.
 */
import type { ClinicId, VisitId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';
import type { VisitRepository } from '../ports/index.js';
import { completeVisit, reopenVisit, type Visit } from './visit-lifecycle.js';

/**
 * What both use cases need: the visit repository and the clock.
 *
 * Two interfaces for one object would be three names for the same thing, and both use
 * cases use both — so unlike `AppointmentWriteDependencies`, which exists because its
 * uses genuinely differ, there is nothing to split here.
 */
export interface VisitClosureDependencies {
  readonly visits: VisitRepository;
  readonly clock: Clock;
}

/**
 * Close a visit: the clinician finished with the patient.
 *
 * The end time comes from the clock and is handed to the repository, which is the whole
 * point of this slice. `DrizzleVisitRepository.updateStatus` used to stamp its own
 * `new Date()` and ignore the entity the domain had built, so the endpoint's answer and
 * the row it wrote disagreed by however long the request took (ADR 0022).
 *
 * A visit belonging to another clinic answers `NOT_FOUND`, the same as one that does not
 * exist — saying otherwise would confirm that the id is real somewhere else
 * (ADR 0014). `findById` cannot tell those apart, so it does not try.
 */
export async function completeVisitRecord(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: VisitClosureDependencies,
): Promise<Visit> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const completed = completeVisit(visit, dependencies.clock.now());

  await dependencies.visits.updateStatus(clinicId, visitId, completed.status, completed.endedAt);

  return completed;
}

/**
 * Re-open a closed visit, because clinicians amend records.
 *
 * **`endedAt` is cleared, and the appointment is not touched.** Clearing it is what
 * makes the row honest — a visit with an end time and an open status would tell the
 * patient profile two different stories — and it happens in the same statement as the
 * status, so nothing reading between two writes sees an open visit that still claims to
 * have ended.
 *
 * Nothing records *that* this happened beyond `updated_at`, and no timestamp argument is
 * accepted, because there is no column that could hold one and nothing reads it yet. The
 * audit this needs has to wait for a person to attribute it to (ADR 0022).
 */
export async function reopenVisitRecord(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: VisitClosureDependencies,
): Promise<Visit> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const reopened = reopenVisit(visit);

  await dependencies.visits.updateStatus(clinicId, visitId, reopened.status, null);

  return reopened;
}
