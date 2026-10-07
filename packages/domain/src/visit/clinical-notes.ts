/**
 * The notes a clinician writes on a visit — the smallest complete slice of the
 * workspace's "notes" section.
 *
 * **A note has no clinic of its own, and that is a fact rather than a shortcut.**
 * `clinical_notes` carries `visit_id` and no `clinic_id`, so the visit the note names
 * *is* the tenant key. Both use cases therefore read the visit first: the read is what
 * decides whether this clinic may see or write the note, and a note for another
 * clinic's visit is `NOT_FOUND`, indistinguishable from a visit that does not exist
 * (ADR 0014). The repository's `findForVisit` re-scopes through a join for the same
 * reason — defence in depth on a read is not a scoping strategy.
 *
 * **Why read *then* write, instead of one statement that checks the join**: the two
 * uses disagree about who should know. The read use case has to answer 404 for a
 * foreign visit rather than `[]`, because an empty note list is otherwise a true
 * answer to a question about a subject that was never in this clinic. The write use
 * case has to answer it before anything is inserted, so the refusal arrives as a
 * domain error rather than as a foreign-key violation translated afterwards.
 *
 * **`authorId` is always `null` today, and that is deliberate.** There is no user
 * model to attribute a note to — the same open question the audit trail waits on
 * (ADR 0022). The column exists and is nullable so that attribution becomes a write
 * and a migration, not a redesign.
 *
 * **No `UnitOfWork`**, for the reason `visit-write.ts` gives: one row, one statement.
 * Nothing else changes when a note is filed.
 */
import type { ClinicalNoteId, ClinicId, IsoDateTime, UserId, VisitId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { ClinicalNoteRepository, VisitRepository } from '../ports/index.js';
import { getVisit } from './visit-read.js';

/**
 * One note, as the table holds it.
 *
 * `body` is stored trimmed, and never empty: a note that says nothing is a row that
 * costs a reader's attention and answers no question. The boundary schema refuses it
 * too, but the rule lives here so a future caller without a schema cannot file one.
 */
export interface ClinicalNote {
  readonly id: ClinicalNoteId;
  readonly visitId: VisitId;
  /** Null until there is a user model to attribute it to (ADR 0022, open question). */
  readonly authorId: UserId | null;
  readonly body: string;
  readonly createdAt: IsoDateTime;
}

/** What a read needs: the visit to scope through, and the notes themselves. */
export interface ClinicalNoteReadDependencies {
  readonly visits: VisitRepository;
  readonly notes: ClinicalNoteRepository;
}

/** A write adds the two things only a writer knows: whose clock, and what id. */
export interface ClinicalNoteWriteDependencies extends ClinicalNoteReadDependencies {
  readonly clock: Clock;
  readonly newId: () => ClinicalNoteId;
}

/**
 * Every note on one visit, oldest first — the order a reader of a clinical record
 * expects, and the repository's to decide for the same reason the patient timeline's
 * order is (ADR 0023).
 *
 * 404 for a visit this clinic does not hold, and `[]` only for a visit that does.
 * This is the subject-shaped read of `getVisit`, not the subject-less list of
 * `listVisitsForPatient`: notes belong to a visit, so the visit has to be there
 * before its notes can be an empty truth.
 */
export async function listClinicalNotes(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: ClinicalNoteReadDependencies,
): Promise<readonly ClinicalNote[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.notes.findForVisit(clinicId, visitId);
}

/**
 * File a note on a visit this clinic holds, and answer with it as written.
 *
 * The clock stamps `createdAt` and the id comes from the caller's generator — the same
 * division of labour every write here has, so a test can hold both still.
 *
 * A blank body is `INVALID_INPUT` rather than a stored empty row: the schema refuses it
 * at the boundary with a sentence a client can show, and this refusal is the rule
 * itself, in case a caller ever reaches the use case without going through one.
 */
export async function addClinicalNote(
  clinicId: ClinicId,
  visitId: VisitId,
  body: string,
  dependencies: ClinicalNoteWriteDependencies,
): Promise<ClinicalNote> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const text = body.trim();

  if (!text) {
    throw new DomainError('INVALID_INPUT', 'A note needs a body', { visitId });
  }

  const note: ClinicalNote = {
    id: dependencies.newId(),
    visitId,
    authorId: null,
    body: text,
    createdAt: dependencies.clock.now(),
  };

  await dependencies.notes.save(note);

  return note;
}
