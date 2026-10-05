/**
 * Reading a visit.
 *
 * Two questions, and they are the only two: **what is this visit** and **what has this
 * patient been through**. There is deliberately no third — no filterable collection
 * across the clinic, because no question about visits is answered by a window and a set
 * of filters the way the agenda's is (ADR 0023).
 *
 * **These functions are thin, and that is the honest shape for a read.** Each is the
 * clinic-scoped repository call plus the one decision that is not the repository's to
 * make: turning "no row" into an error for the single visit, and into an **empty list**
 * for the timeline. That second one is a decision, not a default:
 *
 *   - `GET /patients/:id/visits` for a patient who has never been treated answers `200`
 *     with `[]`, not `404`. A patient with no visits is not a missing patient.
 *   - The same route for a patient **another clinic** holds also answers `[]`, and that
 *     is the same `NOT_FOUND` as an id that is nowhere, wearing a different shape
 *     (ADR 0014). The two are indistinguishable on purpose. A list endpoint cannot
 *     refuse to answer "does this patient exist here" without leaking the answer to
 *     "does this patient exist somewhere" — so it does not answer either question. It
 *     answers only "which visits of theirs may I read", and for a patient outside this
 *     clinic the honest answer is none.
 *
 * The contrast with `GET /patients/:id` is deliberate and is the reason this file
 * exists. That route answers `404` for a patient this clinic does not hold, because its
 * whole job is to describe one patient and there is nothing to describe. A *list* has
 * no such subject: an empty list is a true answer to a question that was asked
 * correctly. Writing the two the same way would mean a timeline that `404`s every
 * untreated patient, which is a bug wearing a rule's clothes.
 */
import type { ClinicId, PatientId, VisitId } from '@denti-code-u3/types';
import type { VisitRepository } from '../ports/index.js';
import { notFound } from '../shared/errors.js';
import type { Visit } from './visit-lifecycle.js';

/** What both reads need, and nothing else: the visit repository. */
export interface VisitReadDependencies {
  readonly visits: VisitRepository;
}

/**
 * One visit, or `NOT_FOUND`.
 *
 * A visit belonging to another clinic raises the same error as one that does not exist,
 * because `findById` cannot tell them apart and must not try (ADR 0014).
 */
export async function getVisit(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: VisitReadDependencies,
): Promise<Visit> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  return visit;
}

/**
 * Every visit of one patient, most recent first.
 *
 * **Uncapped, on purpose.** A silently truncated clinical timeline is worse than a long
 * one: a clinician reading "these are this patient's visits" has to be able to trust
 * that it is all of them. If this ever needs bounding, it needs a count or an explicit
 * truncation marker in the same change — a bare `.limit()` would turn a visible
 * omission into an invisible one (ADR 0023).
 *
 * The ordering is the repository's and is `started_at` descending. Not
 * `coalesce(started_at, created_at)` as the patient profile uses, because that query
 * mixes two orderings into one list and this one is the authoritative history; a visit
 * with no start is not one the domain considers finished either way.
 *
 * An empty array means either "this patient has no visits" or "this patient is not in
 * this clinic". The caller cannot tell them apart and should not be able to — see the
 * note at the top of this file.
 */
export async function listVisitsForPatient(
  clinicId: ClinicId,
  patientId: PatientId,
  dependencies: VisitReadDependencies,
): Promise<readonly Visit[]> {
  return dependencies.visits.findForPatient(clinicId, patientId);
}
