/**
 * The patient's odontogram write — the eighth "per patient/per visit" book, and
 * the first whose subject is the *patient* rather than a single visit.
 *
 * **The chart holds one current state per tooth, and the unique index is the
 * reason.** `odontogram_entries` carries no `clinic_id`, so tenancy comes through
 * the patient — the same "no clinic column of its own" shape as a clinical note's,
 * and the reason both use cases read the subject first (ADR 0014): a patient this
 * clinic does not hold answers 404 before any row moves. But where a note's write
 * is a plain insert, charting a tooth *replaces* the previous state of that tooth:
 * the natural key is `(patient_id, tooth)` and the repository upserts on it (see
 * `OdontogramEntryRepository`), so re-charting tooth 16 is an edit of the chart,
 * never a second row — the row a reader sees is the tooth's current truth.
 *
 * **Dentition is derived, never accepted.** `tooth` is FDI and the dentition is
 * a fact about the tooth number (11–48 permanent, 51–85 primary), not a field of
 * the chart to be told by a client. `dentitionForTooth` answers for the whole
 * tooth, so a body that named the wrong dentition could not disagree with its
 * tooth; the column stores what the number says.
 *
 * **The clock is the only author of when.** `recordedAt` is stamped by the clinic's
 * clock, as a fixed record of when the chart last agreed with the tooth — the same
 * hand that stamps a note's `createdAt` and a record's `performedAt`. No `visitId`
 * yet: charting happens on the patient's profile, and nothing in this milestone
 * attributes a chart entry to a visit (the column exists, and `ON DELETE SET NULL`
 * keeps a row alive if a visit is ever named and then deleted).
 *
 * **Reading *then* writing.** The patient has to exist in this clinic before the
 * tooth is judged, so flow is `getPatient`-shaped even though the chart is the
 * subject: a 404 is the pre-condition, not a translated foreign key. Once the
 * patient is proven, the row is one statement (an upsert, the table's own
 * constraint rather than a transaction), and `save` receives the fully-formed row
 * exactly as the note and prescription ports do.
 */
import type {
  ClinicId,
  IsoDateTime,
  OdontogramEntryId,
  PatientId,
  VisitId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';
import type { OdontogramEntryRepository, PatientRepository } from '../ports/index.js';
import {
  assertValidOdontogramEntry,
  dentitionForTooth,
  type Dentition,
  type OdontogramCondition,
  type OdontogramEntry,
  type OdontogramSurface,
  ODONTOGRAM_SURFACES,
} from './odontogram.js';

/** The row-shaped entry the repository stores and the endpoint answers with. */
export interface OdontogramEntryRecord {
  readonly id: OdontogramEntryId;
  readonly patientId: PatientId;
  /** Null until a visit is ever named by the charting UI; the column allows it. */
  readonly visitId: VisitId | null;
  readonly dentition: Dentition;
  /** FDI two-digit tooth number as text: `11`..`85`. */
  readonly tooth: string;
  readonly surfaces: readonly OdontogramSurface[];
  readonly condition: OdontogramCondition;
  readonly notes: string | null;
  readonly recordedAt: IsoDateTime;
}

/**
 * What a charting request says, in domain terms.
 *
 * `tooth`, `condition` and `surfaces` are the clinician's to state; everything
 * else on the row is derived — the dentition from the tooth, the id from the
 * generator, the clock from the session.
 */
export interface RecordOdontogramEntryInput {
  readonly tooth: string;
  readonly condition: OdontogramCondition;
  readonly surfaces: readonly OdontogramSurface[];
  readonly notes?: string | null;
}

/** Reads the subject and writes the tooth — the two dependencies a chart needs. */
export interface OdontogramWriteDependencies {
  readonly patients: Pick<PatientRepository, 'findOdontogram'>;
  readonly entries: OdontogramEntryRepository;
  readonly clock: Clock;
  readonly newId: () => OdontogramEntryId;
}

/**
 * Chart (or re-chart) one tooth of a patient this clinic holds.
 *
 * The patient is read first — once for tenancy, because the path to a foreign
 * patient's chart must stop with the same 404 every other route gives them (ADR
 * 0014) — and then the tooth is judged: FDI is inferred from the number, the
 * surfaces are reduced to the canonical order and freed of duplicates, a blank
 * note is a `null`, and the `assertValidOdontogramEntry` rules run on the whole
 * thought (a condition that describes a site must name a surface; a surface must
 * exist on the tooth). Only then does the row reach the repository.
 *
 * Returns the row that was stored, so the endpoint can answer 201 with the exact
 * row the chart's refetch will show.
 */
export async function recordOdontogramEntry(
  clinicId: ClinicId,
  patientId: PatientId,
  input: RecordOdontogramEntryInput,
  dependencies: OdontogramWriteDependencies,
): Promise<OdontogramEntryRecord> {
  const chart = await dependencies.patients.findOdontogram(clinicId, patientId);

  if (!chart) {
    throw notFound('Patient', patientId);
  }

  const tooth = input.tooth.trim();

  // Throws INVALID_INPUT with the inapplicable number in its own sentence; the
  // dentition that follows is the number's answer, never the client's.
  const dentition = dentitionForTooth(tooth);

  // Canonical order, unique: the chart stores a set, and "MESIAL, MESIAL" or
  // "DISTAL, MESIAL" are the same finding twice daring you to draw it twice.
  const surfaces = ODONTOGRAM_SURFACES.filter((surface) => input.surfaces.includes(surface));

  const notes = input.notes?.trim() || null;

  const id = dependencies.newId();
  const entry: OdontogramEntry = {
    id,
    patientId,
    dentition,
    tooth,
    surfaces,
    condition: input.condition,
    ...(notes ? { notes } : {}),
  };
  assertValidOdontogramEntry(entry);

  const record: OdontogramEntryRecord = {
    id,
    patientId,
    visitId: null,
    dentition,
    tooth,
    surfaces,
    condition: input.condition,
    notes,
    recordedAt: dependencies.clock.now(),
  };

  // An upsert under the (patient_id, tooth) unique index: the chart's one current
  // state per tooth, refused by the database if a second row ever tries.
  await dependencies.entries.save(record);

  return record;
}
