/**
 * Scheduling: appointments.
 *
 * The end time is deliberately **not stored**. `starts_at + duration_minutes` is
 * the single truth, so a reschedule can never leave a stale end time behind and
 * the agenda can never show two different answers for one appointment.
 *
 * The overlap constraints in
 * `database/migrations/0002_appointment_overlap_expression_guard.sql` are the
 * real scheduling guard: two appointments for the same dentist (or the same
 * chair, or the same room) cannot overlap no matter which code path created
 * them. PostgreSQL refuses the second write. The application check in
 * `packages/domain` gives a friendly message; the database constraint makes the
 * rule unbreakable.
 */

import { relations, sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { appointmentStatusEnum } from './enums.js';
import { chairs, clinics, dentists, rooms } from './organization.js';
import { patients } from './patient.js';

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
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    dentistId: uuid('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    chairId: uuid('chair_id').references(() => chairs.id, { onDelete: 'set null' }),
    /** Always stored in UTC. The clinic time zone is applied at display time. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: appointmentStatusEnum('status').notNull().default('SCHEDULED'),
    /** Set exactly once, by `startVisitFromAppointment`. */
    visitId: uuid('visit_id'),
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
  ],
);

export const appointmentRelations = relations(appointments, ({ one }) => ({
  clinic: one(clinics, { fields: [appointments.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [appointments.patientId], references: [patients.id] }),
  dentist: one(dentists, { fields: [appointments.dentistId], references: [dentists.id] }),
  chair: one(chairs, { fields: [appointments.chairId], references: [chairs.id] }),
}));
