/**
 * The clinic's visits, as a page a person can scan.
 *
 * ADR 0023 deliberately had no collection endpoint: the only questions it heard were
 * "this visit" and "this patient's history". A clinic-wide list is a third question,
 * and it arrived with its own answer — **a clinician sees their own visits, everyone
 * else with `visits:read` sees the clinic's**. The rule lives here rather than in the
 * route (ADR 0011) so the web app, the desktop app and any future client cannot
 * disagree about who sees what, and so it can be tested without an HTTP server.
 *
 * **This is a default view, not a second read barrier.** `GET /visits/:visitId` is
 * still clinic-scoped by permission: any member of staff who may read visits can open
 * one they are told about. Hiding other clinicians' rows from the directory is a
 * matter of giving a dentist their own work instead of a firehose, not of asserting
 * that the other visits are secret from them.
 *
 * **A dentist with no dentist row sees an empty page.** The login and the clinical
 * roster are two tables; an administrator can create a `DENTIST` user before linking
 * it. Returning nothing is honest — there is no clinician whose visits those would be
 * — and it is a visible state the clinic can fix, unlike silently showing everything.
 *
 * Everyone else sees every visit. `ADMINISTRATOR` is the manager the request names;
 * `RECEPTIONIST` and `ASSISTANT` are operational roles that check patients in and out
 * and have always been able to open any visit in the clinic. Narrowing those two would
 * need a rule about which clinician an assistant belongs to, which the data does not
 * model. Recorded as an open question rather than decided by omission.
 */

import type { ClinicId, DentistId, IsoDateTime, PatientId, VisitId } from '@denti-code-u3/types';
import type { Principal } from '../organization/auth.js';
import type { DentistRepository, Page, PageRequest, VisitRepository } from '../ports/index.js';
import type { VisitStatus } from './visit-status.js';

/**
 * One row of the directory.
 *
 * Names, not just ids: a list that made the browser fetch each patient and clinician
 * separately would be N+1 requests for a page whose whole purpose is an overview. The
 * names are the visit's patient and clinician as they are stored *now*; a renamed
 * patient reads with the current name, which is what the clinic expects and what the
 * rest of the app does.
 */
export interface VisitListEntry {
  readonly id: VisitId;
  readonly patientId: PatientId;
  /** Preferred name when the patient has one, otherwise `first last`. */
  readonly patientName: string;
  readonly dentistId: DentistId | null;
  /** Null once the clinician has left the clinic, or on a visit with no clinician. */
  readonly dentistName: string | null;
  readonly status: VisitStatus;
  readonly startedAt: IsoDateTime | null;
  readonly endedAt: IsoDateTime | null;
}

/**
 * What the repository may be asked for.
 *
 * `dentistId` is separate from the actor's request on purpose: a caller supplies the
 * page, and only this module supplies the filter. A route that could name a dentist
 * would be a route that could ask for somebody else's list.
 */
export interface VisitListQuery extends PageRequest {
  readonly dentistId?: DentistId;
}

export interface VisitListDependencies {
  readonly visits: VisitRepository;
  readonly dentists: Pick<DentistRepository, 'findByUserId'>;
}

/**
 * A page of the visits `actor` may see, most recent first.
 *
 * The only decision made here is the scope. Paging, ordering and the join belong to
 * the repository, and an empty page is a valid answer for both "no visits yet" and
 * "this dentist is not linked" — neither is an error.
 */
export async function listVisitsForActor(
  clinicId: ClinicId,
  actor: Pick<Principal, 'userId' | 'role'>,
  request: PageRequest,
  dependencies: VisitListDependencies,
): Promise<Page<VisitListEntry>> {
  if (actor.role !== 'DENTIST') {
    return dependencies.visits.listForClinic(clinicId, request);
  }

  const dentist = await dependencies.dentists.findByUserId(clinicId, actor.userId);

  if (!dentist) {
    return { items: [], total: 0 };
  }

  return dependencies.visits.listForClinic(clinicId, { ...request, dentistId: dentist.id });
}
