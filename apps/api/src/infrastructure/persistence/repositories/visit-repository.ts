/**
 * Visit persistence, on PostgreSQL.
 *
 * Mirrors `appointment-repository.ts` in its two commitments:
 *
 *  - **Clinic scope is a parameter, not ambient state.** Every query filters
 *    `clinic_id`, because a patient's clinical record is not public information
 *    (ADR 0014). A visit belonging to another clinic is `undefined`, the same answer
 *    as one that does not exist — saying otherwise would leak that the id is real.
 *  - **The write is two rows, so it arrives inside a transaction** and not as two
 *    calls a caller might not make together (ADR 0021).
 *
 * The tenant guarantees the read side relies on are the database's, added in migration
 * 0003: a visit's patient, dentist and chair are composite foreign keys over
 * `(id, clinic_id)`, so a row that named another clinic's patient could not have been
 * written in the first place. Nothing here re-checks that.
 */
import {
  DomainError,
  type Visit,
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
import { and, desc, eq } from 'drizzle-orm';

import { visits } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isUniqueViolation } from '../postgres-error.js';

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
   * The `visits_appointment_uq` refusal is translated here rather than left as a 500,
   * because it is the one race the domain cannot see on its own: `startVisit` reads the
   * appointment, finds no `visit_id` on it, and builds a visit — while a second
   * request does the same for the same booking. Both are correct until the index says
   * otherwise, and the index is the only place they were ever both visible.
   *
   * The error is `DUPLICATED_RECORD` rather than a conflict, which is what the domain
   * already throws when it finds the appointment already has a visit: the second
   * writer deserves the same answer as the first, from the only place that can tell
   * them apart.
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
      throw error;
    }
  }
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
