/**
 * Scheduling: appointments.
 *
 * The end time is deliberately **not stored**. `starts_at + duration_minutes` is
 * the single truth, so a reschedule can never leave a stale end time behind and
 * the agenda can never show two different answers for one appointment.
 *
 * The overlap constraints in
 * `database/migrations/0001_appointment_overlap_guard.sql` are the
 * real scheduling guard: two appointments for the same dentist (or the same
 * chair, or the same room) cannot overlap no matter which code path created
 * them. PostgreSQL refuses the second write. The application check in
 * `packages/domain` gives a friendly message; the database constraint makes the
 * rule unbreakable.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core/columns/common';

import { appointmentStatusEnum } from './enums.js';
import { chairs, clinics, dentists, rooms } from './organization.js';
import { patients } from './patient.js';
import { visits } from './visit.js';

/**
 * End of an appointment, as SQL.
 *
 * This is the SQL twin of `appointmentEndsAt` in `packages/domain` and of the
 * `appointment_ends_at` function the migration installs. All three must agree:
 * the domain computes it for messages and UI, and the database computes it for
 * the exclusion constraints.
 *
 * `timestamptz + interval` is STABLE, not IMMUTABLE, so this expression cannot
 * live in a generated column or an index expression — the function in the
 * migration carries the IMMUTABLE promise explicitly instead. That is why a
 * query cannot reuse the column it does not have, and why this fragment exists.
 */
export const appointmentEndsAtSql = sql`${sql.identifier('appointment_ends_at')}(
  ${sql.identifier('appointments')}.${sql.identifier('starts_at')},
  ${sql.identifier('appointments')}.${sql.identifier('duration_minutes')}
)`;

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    /**
     * Not a column-level reference. The four references below are *composite*,
     * over `(id, clinic_id)`, and the reason is tenant isolation.
     *
     * A foreign key on `patient_id` alone proves the patient exists and nothing
     * more. Clinic A's book could then hold an appointment for clinic B's
     * patient — a real id, so the constraint is satisfied — and the agenda's join
     * would put another clinic's patient name on clinic A's screen. The rule
     * "a booking belongs to the same clinic as its patient, its dentist, its chair
     * and its room" is one the database can enforce, so it is enforced here rather
     * than in a check somebody can forget (ADR 0014, ADR 0018).
     */
    patientId: uuid('patient_id').notNull(),
    /** Null once the dentist leaves the clinic: `on delete set null (dentist_id)`. */
    dentistId: uuid('dentist_id'),
    /** Null once the room is removed. */
    roomId: uuid('room_id'),
    /** Null once the chair is removed. */
    chairId: uuid('chair_id'),
    /** Always stored in UTC. The clinic time zone is applied at display time. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: appointmentStatusEnum('status').notNull().default('SCHEDULED'),
    /** Set exactly once, by `startVisitFromAppointment`.
     *
     * The other half of the pair with `visits.appointment_id`, and declared with the
     * same lazy arrow for the same load-order reason: the two schema files reference
     * each other, and only a deferred reference survives either being evaluated
     * first. `restrict` rather than `set null`, because nulling this would leave an
     * appointment marked `IN_TREATMENT` with no clinical record behind it (ADR 0021).
     */
    visitId: uuid('visit_id').references((): AnyPgColumn => visits.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    cancelledReason: text('cancelled_reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('appointments_clinic_starts_at_idx').on(table.clinicId, table.startsAt),
    index('appointments_dentist_starts_at_idx').on(table.dentistId, table.startsAt),
    index('appointments_patient_starts_at_idx').on(table.patientId, table.startsAt),
    index('appointments_chair_starts_at_idx').on(table.chairId, table.startsAt),
    // A duration of zero or a negative one would make every overlap check a
    // no-op, so the database refuses it as well as the domain.
    check('appointments_duration_positive', sql`${table.durationMinutes} > 0`),

    // Tenant foreign keys. Every one pairs the resource with `clinic_id`, so an
    // appointment can only reference a resource of its own clinic.
    //
    // The three nullable ones carry `on delete set null` with an explicit
    // *column list* in the generated SQL: without the list, deleting a dentist
    // would try to null `clinic_id` too, and the row would be rejected by its own
    // NOT NULL — a dentist could never leave a clinic that has appointments
    // behind it. That form needs PostgreSQL 15 or later, which the compose file
    // pins; `database/migrations/0001_appointment_overlap_guard.sql` records the
    // reasoning for the other half of the scheduling guard.
    foreignKey({
      columns: [table.patientId, table.clinicId],
      foreignColumns: [patients.id, patients.clinicId],
      name: 'appointments_patient_same_clinic_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.dentistId, table.clinicId],
      foreignColumns: [dentists.id, dentists.clinicId],
      name: 'appointments_dentist_same_clinic_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.roomId, table.clinicId],
      foreignColumns: [rooms.id, rooms.clinicId],
      name: 'appointments_room_same_clinic_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.chairId, table.clinicId],
      foreignColumns: [chairs.id, chairs.clinicId],
      name: 'appointments_chair_same_clinic_fk',
    }).onDelete('set null'),
  ],
);

export const appointmentRelations = relations(appointments, ({ one }) => ({
  clinic: one(clinics, { fields: [appointments.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [appointments.patientId], references: [patients.id] }),
  dentist: one(dentists, { fields: [appointments.dentistId], references: [dentists.id] }),
  chair: one(chairs, { fields: [appointments.chairId], references: [chairs.id] }),
}));
