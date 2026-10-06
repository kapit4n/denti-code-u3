/**
 * Appointment persistence, on PostgreSQL.
 *
 * Mirrors `patient-repository.ts` in its two commitments:
 *
 *  - **Clinic scope is a parameter, not ambient state.** Every query filters
 *    `clinic_id`, because a clinic's book is not public information (ADR 0014).
 *  - **The window is half-open on both sides.** `[from, to)`, and each
 *    appointment compared as its own `[starts_at, ends_at)` against it. That is
 *    the interval the database's exclusion constraints use, so what the agenda
 *    shows and what the database refuses to double-book are one question asked
 *    the same way twice.
 *
 * The write side is here for the same reason the read side is: the scheduling
 * rules are in the domain (ADR 0018), but the *guarantee* is PostgreSQL's. The
 * exclusion constraints refuse a second overlapping write whatever produced it,
 * and the two `23P01` translations below are what turn that refusal into a
 * message a receptionist can act on instead of a 500 with a request id.
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
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { appointments, chairs, dentists, patients } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import {
  PG_FOREIGN_KEY_VIOLATION,
  isExclusionViolation,
  isForeignKeyViolation,
} from '../postgres-error.js';

export { isExclusionViolation } from '../postgres-error.js';

/**
 * The appointment's own extent, as the exclusion constraints build it.
 *
 * Calls the database's `appointment_ends_at()` rather than re-deriving the end
 * time here, so this query and the constraints are the same expression. If the two
 * ever disagreed, the agenda would show a free slot the database considers taken.
 */
const APPOINTMENT_SPAN = sql`tstzrange(${appointments.startsAt}, appointment_ends_at(${appointments.startsAt}, ${appointments.durationMinutes}), '[)')`;

/** `tstzrange` over the window: the same interval, expressed over the arguments. */
function windowSpan(window: AppointmentWindow) {
  return sql`tstzrange(${window.from}, ${window.to}, '[)')`;
}

/**
 * The columns of an agenda row, named once.
 *
 * `findAgenda`, `findEntryById` and `findOverlapping` cannot each pick their own:
 * the write side answers with an `AgendaEntry` read back through this projection,
 * so if it drifted from the agenda's, the screen would show a different row after a
 * drag than it does after a refresh.
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
  // The bridge link, read because the domain needs it: an appointment that already
  // became a visit is refused by a rule in `startVisitFromAppointment`, and a
  // projection that omitted this column would make that rule dead code, leaving every
  // duplicate to be caught by the unique index instead. The index would still answer
  // correctly — but as a 409 from a constraint rather than a refusal that names the
  // reason, and only for the sequential case. The race is the index's alone.
  visitId: appointments.visitId,
} as const;

export class DrizzleAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: DentiDatabase) {}

  /**
   * Every appointment whose own extent overlaps the window, in start order.
   *
   * Overlap rather than `starts_at >= from`, because a 23:30 booking that runs
   * past midnight belongs on tomorrow's agenda as well, and comparing start times
   * alone would hide it from the second day.
   *
   * Cancelled and no-show appointments are included. They were on the calendar,
   * and a receptionist needs to see that a slot is deliberately empty rather than
   * free — whether a status *reserves* a slot is a scheduling question
   * (`reservesSchedulingSlot`), not a listing one.
   */
  async findAgenda(clinicId: ClinicId, window: AgendaWindow): Promise<readonly AgendaEntry[]> {
    const filters = [
      eq(appointments.clinicId, clinicId),
      sql`${APPOINTMENT_SPAN} && tstzrange(${window.from}, ${window.to}, '[)')`,
      // A withdrawn patient keeps their row for traceability and must not appear
      // on a working agenda. The read side applies this filter everywhere already;
      // an agenda that showed anonymised patients would be the one place that did
      // not, which is exactly the inconsistency that hides.
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
      // Left joins, not inner: `dentist_id` and `chair_id` are `on delete set
      // null`, so an appointment whose dentist has left the clinic is a real row
      // with a real booking. An inner join here would silently drop it.
      .leftJoin(dentists, eq(dentists.id, appointments.dentistId))
      .leftJoin(chairs, eq(chairs.id, appointments.chairId))
      .where(and(...filters))
      // The id is the tie-breaker: two appointments starting at the same instant
      // would otherwise come back in whatever order the plan happens to produce,
      // and a calendar whose columns shuffle on refresh is unusable.
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
      // The clinic scope is in the WHERE clause, not a lookup the caller did
      // first: an appointment belonging to another clinic is indistinguishable
      // from one that does not exist (ADR 0014).
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
      .where(
        and(eq(appointments.clinicId, clinicId), sql`${APPOINTMENT_SPAN} && ${windowSpan(window)}`),
      )
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
      // constraint is what makes the answer true: it is the only thing that sees
      // two requests at the same instant, and this is where its refusal becomes a
      // 409 a receptionist can act on rather than a 500 (ADR 0018).
      if (isExclusionViolation(error)) {
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
          // `status` is not in this list. Whether a schedule may change at all is
          // a domain rule, and a repository that could set it would let a
          // cancelled appointment be rebooked by a write that meant to move it.
          updatedAt: new Date(),
        })
        .where(
          and(eq(appointments.id, appointment.id), eq(appointments.clinicId, appointment.clinicId)),
        )
        .returning(ENTITY_COLUMNS);

      return row ? toEntity(row) : undefined;
    } catch (error) {
      if (isExclusionViolation(error)) {
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
      // A transition *into* a slot-reserving status is also a scheduling act, and
      // the partial exclusion constraints apply to the new row like any other
      // write. The domain checked for a conflict first; this is what makes the
      // answer true when two receptionists un-cancel at once.
      const [row] = await this.db
        .update(appointments)
        .set({
          status,
          // Written only for a cancellation, and cleared for anything else: a
          // reason left over from an earlier cancellation is a lie about the
          // current one.
          ...(status === 'CANCELLED' && cancelledReason ? { cancelledReason } : {}),
          ...(status !== 'CANCELLED' ? { cancelledReason: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
        .returning(ENTITY_COLUMNS);

      return row ? toEntity(row) : undefined;
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new DomainError(
          'SCHEDULING_CONFLICT',
          'The appointment cannot take that status: the slot is already taken',
          { appointmentId, status },
        );
      }
      throw rethrowAsReferenceError(error);
    }
  }

  /**
   * Record that this appointment became a visit.
   *
   * One statement, and the reason is the same as the transaction around it: `visit_id`
   * and the status are two columns describing one event, so a write that could set one
   * without the other leaves an appointment claiming a clinical record that does not
   * exist (ADR 0021).
   *
   * The status arrives as a parameter even though `IN_TREATMENT` is the only value
   * this bridge can produce, because the rule that chooses it lives in the domain and
   * a repository that hardcoded it would be a second copy of that rule — the one place
   * a persistence class should not have opinions.
   */
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

  /**
   * The agenda's own query, narrowed to one appointment.
   *
   * Same joins, same filters, same projection — the anonymised-patient filter
   * included. A write that answered with a row the agenda would have hidden would
   * be answering with a row a refresh then contradicts.
   */
  private entryQuery() {
    return (
      this.db
        .select(ENTRY_COLUMNS)
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        // Left joins, not inner: `dentist_id` and `chair_id` are `on delete set
        // null`, so an appointment whose dentist has left the clinic is a real row
        // with a real booking.
        .leftJoin(dentists, eq(dentists.id, appointments.dentistId))
        .leftJoin(chairs, eq(chairs.id, appointments.chairId))
    );
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
    // Computed, never selected: the table has no such column, and adding one is
    // the mistake ADR 0012 exists to prevent.
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
    // Null, not a stand-in: a booking outlives the dentist who was going to
    // perform it, and a null holds no dentist resource (ADR 0018).
    dentistId: row.dentistId === null ? null : asDentistId(row.dentistId),
    ...(row.roomId ? { roomId: row.roomId } : {}),
    ...(row.chairId ? { chairId: asChairId(row.chairId) } : {}),
    // Absent rather than null while there is no visit: the domain reads this to refuse a
    // second one, and `undefined` is how "this booking has not been started" is
    // spelled everywhere else in the entity.
    ...(row.visitId ? { visitId: asVisitId(row.visitId) } : {}),
    startsAt: row.startsAt.toISOString() as IsoDateTime,
    durationMinutes: row.durationMinutes,
    status: row.status,
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.cancelledReason ? { cancelledReason: row.cancelledReason } : {}),
  };
}

/**
 * A reference the clinic does not hold, as a 422 rather than a 500.
 *
 * The tenant foreign keys added in `0002_appointment_tenant_foreign_keys` make
 * this one error for two situations: an id that does not exist, and an id that
 * exists in another clinic. They are the same answer on purpose — a request scoped
 * to one clinic is told nothing about another clinic's rows (ADR 0014) — and both
 * are a bad reference rather than a broken server.
 */
function rethrowAsReferenceError(error: unknown): unknown {
  if (isForeignKeyViolation(error)) {
    return new DomainError(
      'INVALID_INPUT',
      'That patient, dentist, chair or room is not in this clinic',
      { postgresCode: PG_FOREIGN_KEY_VIOLATION },
    );
  }
  return error;
}
