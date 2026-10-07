/**
 * Appointment persistence, on SQLite.
 *
 * The SQLite twin of `repositories/appointment-repository.ts`, written against
 * the SQLite schema (ADR 0025) with three differences the engine dictates:
 *
 *  - **Overlap is integer math, not `tstzrange`.** PostgreSQL compares
 *    `tstzrange` intervals (`&&`); SQLite compares epoch-millisecond integers.
 *    `starts_at` is stored as ms, and the end is `+ duration_minutes * 60000`,
 *    the same minutes-only offset the overlap triggers use
 *    (`database/schema/sqlite/appointment.ts`). Because integer arithmetic is
 *    exact, the agenda's answer and the triggers' answer are the same question
 *    asked identically.
 *  - **The refusal is a trigger, not an exclusion constraint.** The overlap
 *    guards are `BEFORE INSERT/UPDATE` triggers that `raise(abort, ...)`, which
 *    better-sqlite3 reports as `SqliteError` code `SQLITE_CONSTRAINT_TRIGGER`
 *    with our message. `isSchedulingConflict` in `sqlite-error.ts` turns that
 *    into the same `SCHEDULING_CONFLICT` the PostgreSQL side raises for `23P01`.
 *  - **Foreign keys report their own code.** A reference the clinic does not
 *    hold is `SQLITE_CONSTRAINT_FOREIGNKEY` from the composite keys in
 *    migration 0002 — mapped to the same `INVALID_INPUT` as the PostgreSQL
 *    side's `23503`.
 */

import {
  appointmentEndsAt,
  DomainError,
  type AgendaEntry,
  type AgendaWindow,
  type Appointment,
  type AppointmentRepository,
  type AppointmentStatus,
  type AppointmentWindow,
} from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type AppointmentId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { appointments, chairs, dentists, patients } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import {
  isForeignKeyViolation,
  isSchedulingConflict,
  SQLITE_CONSTRAINT_FOREIGNKEY,
} from '../sqlite-error.js';

/**
 * The appointment's own extent, as the overlap triggers build it.
 *
 * `starts_at` is epoch milliseconds and the end is a minutes-only offset, so the
 * extent can be written directly from the column; it is the SQLite twin of the
 * PostgreSQL `tstzrange(...)` span. Both must agree, because the agenda shows
 * what the database refuses to double-book. (The schema file also exports this
 * as `appointmentEndsAtSql`; it is re-derived here so this query binds the
 * columns through Drizzle like the PostgreSQL one does.)
 */
const APPOINTMENT_SPAN = sql`(${appointments.startsAt} + ${appointments.durationMinutes} * 60000)`;

/** The window's bounds as epoch milliseconds, compared against the integer column. */
function overlapsWindow(window: AppointmentWindow): SQL {
  // `starts_at < window.to` and `ends_at > window.from`: the half-open interval
  // is `[from, to)`, unchanged in meaning from the `tstzrange` both sides.
  return sql`${appointments.startsAt} < ${Date.parse(window.to)} AND ${APPOINTMENT_SPAN} > ${Date.parse(window.from)}`;
}

/**
 * The columns of an agenda row, named once — the identical projection to the
 * PostgreSQL twin, so the agenda's visible shape is the same on both engines.
 */
const ENTRY_COLUMNS = {
  id: appointments.id,
  clinicId: appointments.clinicId,
  patientId: appointments.patientId,
  patientFirstName: patients.firstName,
  patientLastName: patients.lastName,
  dentistId: appointments.dentistId,
  dentistFullName: dentists.fullName,
  chairId: appointments.chairId,
  chairName: chairs.name,
  startsAt: appointments.startsAt,
  durationMinutes: appointments.durationMinutes,
  status: appointments.status,
  notes: appointments.notes,
} as const;

/** The entity's own columns, with no join: what the use cases reason about. */
const ENTITY_COLUMNS = {
  id: appointments.id,
  clinicId: appointments.clinicId,
  patientId: appointments.patientId,
  dentistId: appointments.dentistId,
  chairId: appointments.chairId,
  roomId: appointments.roomId,
  startsAt: appointments.startsAt,
  durationMinutes: appointments.durationMinutes,
  status: appointments.status,
  notes: appointments.notes,
  cancelledReason: appointments.cancelledReason,
  visitId: appointments.visitId,
} as const;

export class SQLiteAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Every appointment whose own extent overlaps the window, in start order.
   *
   * Same shape, same filters (the anonymised-patient filter included), same
   * cancelled/no-show inclusion as the PostgreSQL twin: overlap on integer
   * milliseconds, a 23:30 booking that runs past midnight belongs on the next
   * day's agenda too.
   */
  async findAgenda(clinicId: ClinicId, window: AgendaWindow): Promise<readonly AgendaEntry[]> {
    const filters = [
      eq(appointments.clinicId, clinicId),
      overlapsWindow(window),
      isNull(patients.anonymizedAt),
    ];

    if (window.dentistIds && window.dentistIds.length > 0) {
      filters.push(inArray(appointments.dentistId, [...window.dentistIds]));
    }
    if (window.chairIds && window.chairIds.length > 0) {
      filters.push(inArray(appointments.chairId, [...window.chairIds]));
    }
    const rows = await this.db
      .select(ENTRY_COLUMNS)
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .leftJoin(dentists, eq(dentists.id, appointments.dentistId))
      .leftJoin(chairs, eq(chairs.id, appointments.chairId))
      .where(and(...filters))
      .orderBy(asc(appointments.startsAt), asc(appointments.id));

    return rows.map(toEntry);
  }

  async findById(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
  ): Promise<Appointment | undefined> {
    const [row] = await this.db
      .select(ENTITY_COLUMNS)
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
      .limit(1);

    return row ? toEntity(row) : undefined;
  }

  async findEntryById(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
  ): Promise<AgendaEntry | undefined> {
    const [row] = await this.entryQuery()
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.id, appointmentId),
          isNull(patients.anonymizedAt),
        ),
      )
      .limit(1);

    return row ? toEntry(row) : undefined;
  }

  async findOverlapping(
    clinicId: ClinicId,
    window: AppointmentWindow,
  ): Promise<readonly Appointment[]> {
    const rows = await this.db
      .select(ENTITY_COLUMNS)
      .from(appointments)
      .where(and(eq(appointments.clinicId, clinicId), overlapsWindow(window)))
      .orderBy(asc(appointments.startsAt), asc(appointments.id));

    return rows.map(toEntity);
  }

  async insert(appointment: Appointment): Promise<Appointment> {
    try {
      const [row] = await this.db
        .insert(appointments)
        .values({
          id: appointment.id,
          clinicId: appointment.clinicId,
          patientId: appointment.patientId,
          dentistId: appointment.dentistId,
          chairId: appointment.chairId ?? null,
          roomId: appointment.roomId ?? null,
          startsAt: new Date(appointment.startsAt),
          durationMinutes: appointment.durationMinutes,
          status: appointment.status,
          ...(appointment.notes ? { notes: appointment.notes } : {}),
        })
        .returning(ENTITY_COLUMNS);

      if (!row) {
        throw new DomainError('INVALID_INPUT', 'The appointment was not written', {
          appointmentId: appointment.id,
        });
      }
      return toEntity(row);
    } catch (error) {
      // The domain checked for a conflict a moment ago and found none. The
      // trigger is what makes the answer true: it is the only thing that sees
      // two requests at the same instant (ADR 0018).
      if (isSchedulingConflict(error)) {
        throw new DomainError(
          'SCHEDULING_CONFLICT',
          'The appointment was booked into a slot that is already taken',
          { appointmentId: appointment.id, startsAt: appointment.startsAt },
        );
      }
      throw rethrowAsReferenceError(error);
    }
  }

  async replaceSchedule(appointment: Appointment): Promise<Appointment | undefined> {
    try {
      const [row] = await this.db
        .update(appointments)
        .set({
          startsAt: new Date(appointment.startsAt),
          durationMinutes: appointment.durationMinutes,
          dentistId: appointment.dentistId,
          chairId: appointment.chairId ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(appointments.id, appointment.id), eq(appointments.clinicId, appointment.clinicId)),
        )
        .returning(ENTITY_COLUMNS);

      return row ? toEntity(row) : undefined;
    } catch (error) {
      if (isSchedulingConflict(error)) {
        throw new DomainError(
          'SCHEDULING_CONFLICT',
          'The appointment was moved into a slot that is already taken',
          { appointmentId: appointment.id, startsAt: appointment.startsAt },
        );
      }
      throw rethrowAsReferenceError(error);
    }
  }

  async changeStatus(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
    status: AppointmentStatus,
    cancelledReason?: string,
  ): Promise<Appointment | undefined> {
    try {
      const [row] = await this.db
        .update(appointments)
        .set({
          status,
          ...(status === 'CANCELLED' && cancelledReason ? { cancelledReason } : {}),
          ...(status !== 'CANCELLED' ? { cancelledReason: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
        .returning(ENTITY_COLUMNS);

      return row ? toEntity(row) : undefined;
    } catch (error) {
      if (isSchedulingConflict(error)) {
        throw new DomainError(
          'SCHEDULING_CONFLICT',
          'The appointment cannot take that status: the slot is already taken',
          { appointmentId, status },
        );
      }
      throw rethrowAsReferenceError(error);
    }
  }

  async becomeVisit(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
    visitId: VisitId,
    status: AppointmentStatus,
  ): Promise<Appointment | undefined> {
    const [row] = await this.db
      .update(appointments)
      .set({ visitId, status, updatedAt: new Date() })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
      .returning(ENTITY_COLUMNS);

    return row ? toEntity(row) : undefined;
  }

  private entryQuery() {
    return this.db
      .select(ENTRY_COLUMNS)
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .leftJoin(dentists, eq(dentists.id, appointments.dentistId))
      .leftJoin(chairs, eq(chairs.id, appointments.chairId));
  }
}

function toEntry(row: {
  id: string;
  clinicId: string;
  patientId: string;
  patientFirstName: string;
  patientLastName: string;
  dentistId: string | null;
  dentistFullName: string | null;
  chairId: string | null;
  chairName: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
}): AgendaEntry {
  const startsAt = row.startsAt.toISOString() as IsoDateTime;

  return {
    id: asAppointmentId(row.id),
    clinicId: asClinicId(row.clinicId),
    patientId: asPatientId(row.patientId),
    patientFirstName: row.patientFirstName,
    patientLastName: row.patientLastName,
    dentistId: row.dentistId === null ? null : asDentistId(row.dentistId),
    dentistFullName: row.dentistFullName,
    chairId: row.chairId === null ? null : asChairId(row.chairId),
    chairName: row.chairName,
    startsAt,
    endsAt: appointmentEndsAt(startsAt, row.durationMinutes),
    durationMinutes: row.durationMinutes,
    status: row.status,
    notes: row.notes,
  };
}

function toEntity(row: {
  id: string;
  clinicId: string;
  patientId: string;
  dentistId: string | null;
  chairId: string | null;
  roomId: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
  cancelledReason: string | null;
  visitId: string | null;
}): Appointment {
  return {
    id: asAppointmentId(row.id),
    clinicId: asClinicId(row.clinicId),
    patientId: asPatientId(row.patientId),
    dentistId: row.dentistId === null ? null : asDentistId(row.dentistId),
    ...(row.roomId ? { roomId: row.roomId } : {}),
    ...(row.chairId ? { chairId: asChairId(row.chairId) } : {}),
    ...(row.visitId ? { visitId: asVisitId(row.visitId) } : {}),
    startsAt: row.startsAt.toISOString() as IsoDateTime,
    durationMinutes: row.durationMinutes,
    status: row.status,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.cancelledReason ? { cancelledReason: row.cancelledReason } : {}),
  };
}

/**
 * A reference the clinic does not hold, as a 422 rather than a 500 — the
 * SQLite twin of the PostgreSQL `rethrowAsReferenceError`. The composite
 * foreign keys of migration 0002 make one error of two situations, both a bad
 * reference rather than a broken server (ADR 0014).
 */
function rethrowAsReferenceError(error: unknown): unknown {
  if (isForeignKeyViolation(error)) {
    return new DomainError(
      'INVALID_INPUT',
      'That patient, dentist, chair or room is not in this clinic',
      { sqliteCode: SQLITE_CONSTRAINT_FOREIGNKEY },
    );
  }
  return error;
}
