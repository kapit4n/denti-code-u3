/**
 * What was actually done in a visit — the record, as opposed to the catalogue.
 *
 * `treatment.ts` draws the distinction this file implements: a `Treatment` is a
 * proposal (what could be done), and a record is a fact (what was done). The table
 * is `visit_treatment_executions`; a row joins one visit to one catalogue entry and
 * nothing else — no price is stored, because the executed treatment's price is the
 * charge it becomes (an M8 concern), never a fact the clinical record needs to argue
 * about.
 *
 * **Like a note, a treatment record has no clinic of its own.** `visit_treatment_executions`
 * carries `visit_id` and no `clinic_id`, so tenancy comes through `visits`: the read
 * resolves the visit in this clinic before it answers, exactly as `clinical-notes.ts`
 * does. The **catalogue side is the second scoping read**: `visit_treatment_executions.treatment_id`
 * is a plain foreign key (the visits table could not join to prove it, and the schema
 * deliberately gives executions no composite tenant key), so the write resolves the
 * treatment in the clinic's catalogue first. A treatment this clinic does not offer —
 * or does not exist — is the same `INVALID_INPUT` the FK translation answers for a
 * foreign dentist or chair (ADR 0024): a client that picked from the catalogue could
 * not have produced it, and a client that did not pick from the catalogue gets one
 * consistent refusal.
 *
 * **`tooth` is validated as an FDI number, and the rule lives here.** The schema only
 * checks the shape ("two digits"); whether the digits name a real tooth is a clinical
 * rule, and the odontogram is where this domain keeps them.
 *
 * **The two reads before one insert, and no `UnitOfWork`.** `NOT_FOUND` for a foreign
 * visit (the subject, like notes) and `INVALID_INPUT` for a foreign treatment (the
 * named resource, like a walk-in's dentist) — then a single insert. Everything the
 * insert needs has been checked above it, so a `UnitOfWork` around one statement would
 * be ceremony, and the repository's foreign-key translation is the belt for the race
 * where a treatment is deleted between the read and the insert.
 *
 * **Deliberately not here: the plan link.** The table has a `treatment_plan_item_id`
 * column, and Milestone 8's "Link plan items → visits → charges" will use it. Linking
 * a record to a plan item is a rule about the *plan* — that completing an item happens
 * on this visit — and the plan's lifecycle belongs to M8, not to the record.
 * **Also not here: a status gate.** A record can be written on any visit this clinic
 * holds, open or closed, the way a note can — an append-only clinical record must be
 * able to document what happened, even when it is written after the visit was closed.
 */
import type {
  ClinicId,
  IsoDateTime,
  TreatmentId,
  VisitId,
  VisitTreatmentExecutionId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import { isValidPermanentTooth, isValidPrimaryTooth } from '../odontogram/odontogram.js';
import { getVisit } from '../visit/visit-read.js';
import type {
  TreatmentRecordRepository,
  TreatmentRepository,
  VisitRepository,
} from '../ports/index.js';

/**
 * One treatment performed in one visit, as the table holds it.
 *
 * `performedAt` is the clinic's clock, the same hand that stamps a note's `createdAt`
 * and a visit's `startedAt`: nothing about *when* happened is a client's to say.
 */
export interface TreatmentRecord {
  readonly id: VisitTreatmentExecutionId;
  readonly visitId: VisitId;
  readonly treatmentId: TreatmentId;
  /** FDI tooth, when the record is tooth-specific. */
  readonly tooth: string | null;
  readonly notes: string | null;
  readonly performedAt: IsoDateTime;
}

/** What a read needs: the visit to scope through, and the records themselves. */
export interface TreatmentRecordReadDependencies {
  readonly visits: VisitRepository;
  readonly treatmentRecords: TreatmentRecordRepository;
}

/**
 * A write adds the catalogue to scope the treatment with, and the two things only a
 * writer knows: whose clock and what id.
 */
export interface TreatmentRecordWriteDependencies extends TreatmentRecordReadDependencies {
  readonly treatments: TreatmentRepository;
  readonly clock: Clock;
  readonly newId: () => VisitTreatmentExecutionId;
}

/** The body a caller hands to the write use case, in domain terms. */
export interface NewTreatmentRecord {
  readonly treatmentId: TreatmentId;
  readonly tooth?: string | null;
  readonly notes?: string | null;
}

/**
 * Every treatment recorded on one visit, oldest first.
 *
 * 404 for a visit this clinic does not hold, and `[]` only for a visit that does —
 * the subject-shaped read of `getVisit`, exactly as `listClinicalNotes` argues for
 * its own `[]` (ADR 0014).
 */
export async function listTreatmentRecords(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: TreatmentRecordReadDependencies,
): Promise<readonly TreatmentRecord[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.treatmentRecords.findForVisit(clinicId, visitId);
}

/**
 * Record a treatment performed in a visit this clinic holds.
 *
 * The order is the whole contract: the visit first (the subject — a foreign visit is
 * `NOT_FOUND`), the treatment second (the resource being named — a foreign one is
 * `INVALID_INPUT`, the code the FK translation gave the same situation for a chair),
 * the tooth and notes judged on their own, and only then the insert.
 *
 * A blank tooth or notes is dropped to `null`, not stored empty: an empty string is a
 * field that was typed and then forgotten, and a clinical record that cannot see the
 * difference between "not recorded" and "recorded as nothing" is lying about both.
 */
export async function recordVisitTreatment(
  clinicId: ClinicId,
  visitId: VisitId,
  input: NewTreatmentRecord,
  dependencies: TreatmentRecordWriteDependencies,
): Promise<TreatmentRecord> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const treatment = await dependencies.treatments.findById(clinicId, input.treatmentId);

  if (!treatment) {
    throw new DomainError(
      'INVALID_INPUT',
      'That treatment is not in this clinic\u2019s catalogue',
      { treatmentId: input.treatmentId },
    );
  }

  const tooth = input.tooth?.trim() || null;

  if (tooth && !isValidPermanentTooth(tooth) && !isValidPrimaryTooth(tooth)) {
    throw new DomainError('INVALID_INPUT', `"${tooth}" is not a valid FDI tooth number`, {
      tooth,
    });
  }

  const notes = input.notes?.trim() || null;

  if (notes && notes.length > 2_000) {
    throw new DomainError('INVALID_INPUT', 'Treatment notes are too long', { notes });
  }

  const record: TreatmentRecord = {
    id: dependencies.newId(),
    visitId,
    treatmentId: input.treatmentId,
    tooth,
    notes,
    performedAt: dependencies.clock.now(),
  };

  await dependencies.treatmentRecords.save(record);

  return record;
}
