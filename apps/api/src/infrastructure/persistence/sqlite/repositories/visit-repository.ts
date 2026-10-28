/**
 * Visit persistence, on SQLite — the twin of
 * `repositories/visit-repository.ts` (ADR 0025).
 *
 * The two differences from that file are the engine's:
 *
 *  - The composite tenant foreign keys of the SQLite migration 0002 report as
 *    `SQLITE_CONSTRAINT_FOREIGNKEY`, mapped here to the same `INVALID_INPUT`.
 *  - The `visits_appointment_uq` duplicate is `SQLITE_CONSTRAINT_UNIQUE`,
 *    mapped to the same `DUPLICATED_RECORD` as the PostgreSQL twin's `23505`.
 *
 * Everything else — the clinic-scoped reads, the null-and-cleared `endedAt`,
 * the domain's time rather than the process's — is the same file.
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

import { dentists, patients, visits } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation, isUniqueViolation } from '../sqlite-error.js';

/** The visit's own columns, named once. `dentist_id` and `chair_id` stay null-able. */
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

export class SQLiteVisitRepository implements VisitRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findById(clinicId: ClinicId, visitId: VisitId): Promise<Visit | undefined> {
    const [row] = await this.db
      .select(VISIT_COLUMNS)
      .from(visits)
      .where(and(eq(visits.id, visitId), eq(visits.clinicId, clinicId)));

    return row ? toEntity(row) : undefined;
  }

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

  async findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Visit[]> {
    const rows = await this.db
      .select(VISIT_COLUMNS)
      .from(visits)
      .where(and(eq(visits.clinicId, clinicId), eq(visits.patientId, patientId)))
      .orderBy(desc(visits.startedAt));

    return rows.map(toEntity);
  }

  /**
   * A page of the clinic's visits — the SQLite twin of the PostgreSQL query.
   *
   * Same joins on `(id, clinic_id)`, same `coalesce(started_at, created_at)` order:
   * a visit with no start (a row written by hand before the walk-in door existed)
   * still sorts by when it entered the record, instead of at the top or bottom
   * depending on how the engine treats NULLs in a descending sort.
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
   * Write a visit the domain has already built — the same two refusals as the
   * PostgreSQL twin: a duplicate (`DUPLICATED_RECORD`, the race the
   * appointment door cannot see) and a tenant foreign key (`INVALID_INPUT`,
   * the walk-in that names another clinic).
   */
  async save(visit: Visit): Promise<void> {
    try {
      // `.run()`, not the bare builder: on this driver a statement does nothing
      // until it is executed, and a skipped visit is a silent data loss.
      this.db
        .insert(visits)
        .values({
          id: visit.id,
          clinicId: visit.clinicId,
          patientId: visit.patientId,
          dentistId: visit.dentistId ?? null,
          chairId: visit.chairId ?? null,
          ...(visit.appointmentId ? { appointmentId: visit.appointmentId } : {}),
          status: visit.status,
          ...(visit.startedAt ? { startedAt: new Date(visit.startedAt) } : {}),
          ...(visit.endedAt ? { endedAt: new Date(visit.endedAt) } : {}),
          ...(visit.summary ? { summary: visit.summary } : {}),
        })
        .run();
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
          { sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY' },
        );
      }
      throw error;
    }
  }
}

/**
 * A joined row as the directory's `VisitListEntry` — the PostgreSQL twin's mapping.
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
 * A row as the domain's `Visit` — identical to the PostgreSQL twin's mapping,
 * including the nullable `dentistId` and the branchful `startedAt`/`endedAt`.
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
