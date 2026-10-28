/**
 * Visit persistence, on PostgreSQL.
 *
 * Mirrors `appointment-repository.ts` in its two commitments:
 *
 *  - **Clinic scope is a parameter, not ambient state.** Every query filters
 *    `clinic_id`, because a patient's clinical record is not public information
 *    (ADR 0014). A visit belonging to another clinic is `undefined`, the same answer
 *    as one that does not exist — saying otherwise would leak that the id is real.
 *  - **The two creation doors are handled differently.** A visit started from a
 *    booking writes two rows, so it arrives inside a transaction (ADR 0021); a
 *    walk-in writes one, so it comes through `save` directly, like the two closing
 *    endpoints (ADR 0024).
 *
 * The tenant guarantees the read side relies on are the database's, added in migration
 * 0003: a visit's patient, dentist and chair are composite foreign keys over
 * `(id, clinic_id)`, so a row that named another clinic's patient could not have been
 * written in the first place. Nothing here re-checks that.
 */
import {
  DomainError,
  type Visit,
  type VisitListEntry,
  type VisitListQuery,
  type VisitRepository,
  type VisitStatus,
} from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type PatientId,
  type VisitId,
} from '@denti-code-u3/types';
import { and, count, desc, eq, sql } from 'drizzle-orm';

import { dentists, patients, visits } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import {
  PG_FOREIGN_KEY_VIOLATION,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../postgres-error.js';

/**
 * The visit's own columns, named once.
 *
 * `dentist_id` and `chair_id` are read as they are stored, including a null. That is
 * not sloppiness: both are `on delete set null`, so a clinician who leaves the clinic
 * takes the link and not the visit, and a type that insisted otherwise would have to
 * invent a name for the treatment (ADR 0021).
 */
const VISIT_COLUMNS = {
  id: visits.id,
  clinicId: visits.clinicId,
  patientId: visits.patientId,
  dentistId: visits.dentistId,
  chairId: visits.chairId,
  appointmentId: visits.appointmentId,
  status: visits.status,
  startedAt: visits.startedAt,
  endedAt: visits.endedAt,
  summary: visits.summary,
} as const;

export class DrizzleVisitRepository implements VisitRepository {
  constructor(private readonly db: DentiDatabase) {}

  async findById(clinicId: ClinicId, visitId: VisitId): Promise<Visit | undefined> {
    const [row] = await this.db
      .select(VISIT_COLUMNS)
      .from(visits)
      .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)));

    return row ? toEntity(row) : undefined;
  }

  /**
   * The patient's open visit, if there is one.
   *
   * "Open" rather than "most recent", because the question this answers is "is this
   * patient currently being treated?", and the newest visit answers a different one.
   * `limit(1)` without an order is deliberate for the same reason the appointment
   * read side does it: the clinic's own data is meant to make at most one open visit
   * per patient, so this is a lookup that cannot return more than one row — and if it
   * ever did, the second is a bug worth surfacing rather than silently ranking.
   */
  async findOpenForPatient(clinicId: ClinicId, patientId: PatientId): Promise<Visit | undefined> {
    const [row] = await this.db
      .select(VISIT_COLUMNS)
      .from(visits)
      .where(
        and(
          eq(visits.clinicId, clinicId),
          eq(visits.patientId, patientId),
          eq(visits.status, 'OPEN'),
        ),
      )
      .limit(1);

    return row ? toEntity(row) : undefined;
  }

  /** A patient's visits, most recent first — the clinical timeline's order. */
  async findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Visit[]> {
    const rows = await this.db
      .select(VISIT_COLUMNS)
      .from(visits)
      .where(and(eq(visits.clinicId, clinicId), eq(visits.patientId, patientId)))
      .orderBy(desc(visits.startedAt));

    return rows.map(toEntity);
  }

  /**
   * A page of the clinic's visits, for the directory.
   *
   * The joins are the read model's whole reason for existing: a list needs the
   * patient's and clinician's names, and asking for them per row would turn one
   * page into twenty-one queries. Both joins are on `(id, clinic_id)`, the same
   * tenant pair the foreign keys use, so a row that somehow named another clinic's
   * patient cannot leak a name through this query.
   *
   * The count is a second statement rather than a window function: it is the same
   * `where`, and paging a clinical table is one of the few places where an exact
   * total is worth the extra round trip — "page 2 of 7" has to be true.
   */
  async listForClinic(
    clinicId: ClinicId,
    query: VisitListQuery,
  ): Promise<{ items: readonly VisitListEntry[]; total: number }> {
    const where = and(
      eq(visits.clinicId, clinicId),
      query.dentistId ? eq(visits.dentistId, query.dentistId) : undefined,
    );

    const rows = await this.db
      .select({
        id: visits.id,
        patientId: visits.patientId,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientPreferredName: patients.preferredName,
        dentistId: visits.dentistId,
        dentistName: dentists.fullName,
        status: visits.status,
        startedAt: visits.startedAt,
        endedAt: visits.endedAt,
      })
      .from(visits)
      .innerJoin(
        patients,
        and(eq(patients.id, visits.patientId), eq(patients.clinicId, visits.clinicId)),
      )
      .leftJoin(
        dentists,
        and(eq(dentists.id, visits.dentistId), eq(dentists.clinicId, visits.clinicId)),
      )
      .where(where)
      .orderBy(desc(sql`coalesce(${visits.startedAt}, ${visits.createdAt})`), desc(visits.id))
      .limit(query.limit)
      .offset(query.offset);

    const [counted] = await this.db.select({ total: count() }).from(visits).where(where);

    return {
      items: rows.map(toListEntry),
      total: counted?.total ?? 0,
    };
  }

  /**
   * Move a visit to a new status.
   *
   * The transition itself was checked by the domain before this was called, and the
   * repository does not repeat it — this answers "was the row written", which is the
   * only question a persistence class should be answering.
   *
   * `endedAt` is set for a completed visit and cleared for a reopened one, in the same
   * statement as the status. Two statements would leave a completed visit with no end
   * time visible to anything reading between them.
   */
  async updateStatus(
    clinicId: ClinicId,
    visitId: VisitId,
    status: VisitStatus,
    endedAt: IsoDateTime | null,
  ): Promise<void> {
    const written = await this.db
      .update(visits)
      .set({
        status,
        // The domain's time, not this process's. This line used to be
        // `status === 'COMPLETED' ? new Date() : null`, which decided a clinical fact
        // from the wall clock at the moment the statement ran — so the endpoint's answer
        // and the row it wrote held two different end times, differing by however long
        // the request took, and a fixed-clock test passed against the use case while
        // failing against the table (ADR 0022).
        endedAt: endedAt ? new Date(endedAt) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)))
      .returning({ id: visits.id });

    if (!written) {
      throw new DomainError('NOT_FOUND', `Visit ${visitId} was not found`, { visitId });
    }
  }

  /**
   * Write a visit the domain has already built.
   *
   * Two refusals are translated here rather than left as 500s, and they belong to the
   * two doors that write one row:
   *
   *  - **The `visits_appointment_uq` refusal** is the race the appointment door cannot
   *    see on its own: `startVisit` reads the appointment, finds no `visit_id` on it,
   *    and builds a visit — while a second request does the same for the same booking.
   *    Both are correct until the index says otherwise (ADR 0021). It is reported as
   *    `DUPLICATED_RECORD`, same as the domain's own refusal; a walk-in can never hit
   *    it, because its `appointment_id` is null and the index puts no weight on nulls.
   *  - **A tenant foreign key** answers a walk-in that names a patient, clinician or
   *    chair this clinic does not hold — including one that exists in another clinic.
   *    The walk-in does not read the patient first, exactly as the booking does not
   *    (ADR 0014), so this is where that refusal becomes a 422 rather than the 500 it
   *    would otherwise arrive as.
   */
  async save(visit: Visit): Promise<void> {
    try {
      await this.db.insert(visits).values({
        id: visit.id,
        clinicId: visit.clinicId,
        patientId: visit.patientId,
        // Null rather than undefined: a visit created from an appointment always has
        // a dentist, and `startVisitFromAppointment` refuses the ones that do not, so
        // the null here can only mean a column that has been nulled by a departure.
        dentistId: visit.dentistId ?? null,
        chairId: visit.chairId ?? null,
        ...(visit.appointmentId ? { appointmentId: visit.appointmentId } : {}),
        status: visit.status,
        ...(visit.startedAt ? { startedAt: new Date(visit.startedAt) } : {}),
        ...(visit.endedAt ? { endedAt: new Date(visit.endedAt) } : {}),
        ...(visit.summary ? { summary: visit.summary } : {}),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(
          'DUPLICATED_RECORD',
          'This appointment already has a visit; an appointment becomes a visit exactly once',
          { appointmentId: visit.appointmentId ?? visit.id },
        );
      }
      if (isForeignKeyViolation(error)) {
        throw new DomainError(
          'INVALID_INPUT',
          'That patient, dentist or chair is not in this clinic',
          { postgresCode: PG_FOREIGN_KEY_VIOLATION },
        );
      }
      throw error;
    }
  }
}

/**
 * A joined row as the directory's `VisitListEntry`.
 *
 * The patient's preferred name wins over the legal name exactly as it does on the
 * patient list; a row with no preference reads `first last`. The clinician is
 * nullable because the column is `on delete set null` — a departed clinician leaves
 * the visit, not a name to invent.
 */
function toListEntry(row: {
  id: string;
  patientId: string;
  patientFirstName: string;
  patientLastName: string;
  patientPreferredName: string | null;
  dentistId: string | null;
  dentistName: string | null;
  status: VisitStatus;
  startedAt: Date | null;
  endedAt: Date | null;
}): VisitListEntry {
  return {
    id: asVisitId(row.id),
    patientId: asPatientId(row.patientId),
    patientName: row.patientPreferredName ?? `${row.patientFirstName} ${row.patientLastName}`,
    dentistId: row.dentistId ? asDentistId(row.dentistId) : null,
    dentistName: row.dentistName,
    status: row.status,
    startedAt: row.startedAt ? (row.startedAt.toISOString() as IsoDateTime) : null,
    endedAt: row.endedAt ? (row.endedAt.toISOString() as IsoDateTime) : null,
  };
}

/**
 * A row as the domain's `Visit`.
 *
 * `dentistId` is mapped as the nullable field the domain now declares, rather than
 * omitted when absent: "this visit has no clinician" is a fact about the row, and
 * dropping the key would make it indistinguishable from a visit that was never asked
 * about one (ADR 0021).
 */
function toEntity(row: {
  id: string;
  clinicId: string;
  patientId: string;
  dentistId: string | null;
  chairId: string | null;
  appointmentId: string | null;
  status: VisitStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  summary: string | null;
}): Visit {
  return {
    id: asVisitId(row.id),
    clinicId: asClinicId(row.clinicId),
    patientId: asPatientId(row.patientId),
    dentistId: row.dentistId ? asDentistId(row.dentistId) : null,
    ...(row.chairId ? { chairId: asChairId(row.chairId) } : {}),
    ...(row.appointmentId ? { appointmentId: asAppointmentId(row.appointmentId) } : {}),
    status: row.status,
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() as IsoDateTime } : {}),
    ...(row.endedAt ? { endedAt: row.endedAt.toISOString() as IsoDateTime } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
  };
}
