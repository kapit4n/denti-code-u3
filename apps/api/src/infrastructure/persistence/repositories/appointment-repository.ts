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
 */

import {
  appointmentEndsAt,
  type AgendaEntry,
  type AppointmentRepository,
  type AgendaWindow,
} from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  type ClinicId,
  type IsoDateTime,
} from '@denti-code-u3/types';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { appointments, chairs, dentists, patients } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';

/**
 * The appointment's own extent, as the exclusion constraints build it.
 *
 * Calls the database's `appointment_ends_at()` rather than re-deriving the end
 * time here, so this query and the constraints are the same expression. If the two
 * ever disagreed, the agenda would show a free slot the database considers taken.
 */
const APPOINTMENT_SPAN = sql`tstzrange(${appointments.startsAt}, appointment_ends_at(${appointments.startsAt}, ${appointments.durationMinutes}), '[)')`;

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
      .select({
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
      })
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

    return rows.map((row) => ({
      id: asAppointmentId(row.id),
      clinicId: asClinicId(row.clinicId),
      patientId: asPatientId(row.patientId),
      patientFirstName: row.patientFirstName,
      patientLastName: row.patientLastName,
      dentistId: row.dentistId === null ? null : asDentistId(row.dentistId),
      dentistFullName: row.dentistFullName,
      chairId: row.chairId === null ? null : asChairId(row.chairId),
      chairName: row.chairName,
      startsAt: row.startsAt.toISOString() as IsoDateTime,
      // Computed, never selected: the table has no such column, and adding one is
      // the mistake ADR 0012 exists to prevent.
      endsAt: appointmentEndsAt(row.startsAt.toISOString() as IsoDateTime, row.durationMinutes),
      durationMinutes: row.durationMinutes,
      status: row.status,
      notes: row.notes,
    }));
  }
}
