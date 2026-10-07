/**
 * Scheduling: appointments.
 *
 * The SQLite twin of `database/schema/appointment.ts`. The end time is
 * **not stored** here either, for the reason that produced ADR 0012: a
 * reschedule must never leave a stale end time behind.
 *
 * The overlap guard is not in this file, and the difference is worth stating
 * plainly. PostgreSQL enforces it with `EXCLUDE USING gist` constraints
 * (`database/migrations/0001_appointment_overlap_guard.sql`). SQLite has no
 * exclusion constraints, so the same three rules — one dentist, one chair, one
 * room, never two overlapping appointments that are not cancelled — are
 * enforced by triggers in
 * `database/migrations-sqlite/0001_appointment_overlap_guards.sql`.
 *
 * The expression those triggers use is this file's `appointmentEndsAtSql`: a
 * minutes-only offset from an epoch-millisecond column, which is exact integer
 * arithmetic and therefore has no immutability question to answer at all.
 */

import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core/columns/common';

import { APPOINTMENT_STATUSES } from '@denti-code-u3/domain';

import { nowDefault, uuidDefault } from './defaults.js';
import { enumCheck } from './enum-check.js';
import { chairs, clinics, dentists, rooms } from './organization.js';
import { patients } from './patient.js';
import { visits } from './visit.js';

/**
 * End of an appointment, in epoch milliseconds.
 *
 * The SQLite twin of `appointment_ends_at` and of `appointmentEndsAtSql` in the
 * PostgreSQL schema: all three must agree, because the domain computes the end
 * for messages and the UI while the database computes it for the guards. Here
 * there is nothing to make immutable — the column is an integer of milliseconds
 * and a minutes-only offset is `+ duration_minutes * 60000`.
 */
export const appointmentEndsAtSql = sql`(${sql.identifier('appointments')}.${sql.identifier('starts_at')} + ${sql.identifier('appointments')}.${sql.identifier('duration_minutes')} * 60000)`;

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    /**
     * Not a column-level reference. The four references below are *composite*,
     * over `(id, clinic_id)`, and the reason is tenant isolation — the same
     * rule the PostgreSQL tree states at length in
     * `database/schema/appointment.ts`, and which SQLite enforces with the very
     * same composite foreign keys (ADR 0014, ADR 0018).
     */
    patientId: text('patient_id').notNull(),
    /** Null once the dentist leaves the clinic. See the migration header. */
    dentistId: text('dentist_id'),
    /** Null once the room is removed. */
    roomId: text('room_id'),
    /** Null once the chair is removed. */
    chairId: text('chair_id'),
    /** Always stored in UTC, as epoch milliseconds. */
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: text('status', { enum: APPOINTMENT_STATUSES }).notNull().default('SCHEDULED'),
    /**
     * Set exactly once, by `startVisitFromAppointment`.
     *
     * The other half of the pair with `visits.appointment_id`, declared with the
     * same deferred arrow for the same load-order reason: the two schema files
     * reference each other, and only a deferred reference survives either being
     * evaluated first (ADR 0021). `restrict` rather than `set null`, because
     * nulling this would leave an appointment marked `IN_TREATMENT` with no
     * clinical record behind it.
     */
    visitId: text('visit_id').references((): AnySQLiteColumn => visits.id, {
      onDelete: 'restrict',
    }),
    notes: text('notes'),
    cancelledReason: text('cancelled_reason'),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('appointments_clinic_starts_at_idx').on(table.clinicId, table.startsAt),
    index('appointments_dentist_starts_at_idx').on(table.dentistId, table.startsAt),
    index('appointments_patient_starts_at_idx').on(table.patientId, table.startsAt),
    index('appointments_chair_starts_at_idx').on(table.chairId, table.startsAt),
    // A duration of zero or a negative one would make every overlap check a
    // no-op, so the database refuses it as well as the domain.
    check('appointments_duration_positive', sql`${table.durationMinutes} > 0`),
    enumCheck('appointments_status_in_values', 'status', APPOINTMENT_STATUSES),

    // Tenant foreign keys, over the same composite `(id, clinic_id)` pair the
    // PostgreSQL tree declares in migration 0002. SQLite executes composite
    // foreign keys exactly as PostgreSQL does; what it does *not* have is the
    // column-list form of `ON DELETE SET NULL`, so the three nullable ones are
    // completed by the `BEFORE DELETE` triggers in
    // `database/migrations-sqlite/0002_tenant_key_delete_guards.sql`.
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
