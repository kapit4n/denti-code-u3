/**
 * Clinical encounters: visits and what happens inside them.
 *
 * The SQLite twin of `database/schema/visit.ts`.
 *
 * One type mapping is worth naming because it is not mechanical: a PostgreSQL
 * `enum[]` (`odontogram_entries.surfaces`) has no SQLite counterpart, so it
 * becomes `text` holding JSON. Drizzle's `mode: 'json'` keeps the *TypeScript*
 * side an array on both engines, which is the half that matters — a repository
 * reads `row.surfaces` and must get the same thing either way.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core/columns/common';

import {
  DENTITIONS,
  MEDICATION_ROUTES,
  ODONTOGRAM_CONDITIONS,
  ODONTOGRAM_SURFACES,
  VISIT_STATUSES,
} from '@denti-code-u3/domain';

import { appointments } from './appointment.js';
import { nowDefault, uuidDefault } from './defaults.js';
import { enumCheck } from './enum-check.js';
import { chairs, clinics, dentists } from './organization.js';
import { patients } from './patient.js';

export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: text('patient_id').notNull(),
    /** Null once the clinician leaves the clinic. */
    dentistId: text('dentist_id'),
    /** Null once the chair is removed. */
    chairId: text('chair_id'),
    /**
     * Null only for a walk-in. When present it must name a real appointment, and
     * it is unique — an appointment becomes a visit exactly once (ADR 0021).
     *
     * `.references()` rather than the `foreignKey()` helper, because `visit.ts`
     * and `appointment.ts` reference each other and only a deferred arrow
     * survives either being evaluated first. `restrict` rather than
     * `set null`: an appointment with a visit is not deleted, it is cancelled.
     */
    appointmentId: text('appointment_id').references((): AnySQLiteColumn => appointments.id, {
      onDelete: 'restrict',
    }),
    status: text('status', { enum: VISIT_STATUSES }).notNull().default('OPEN'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    reason: text('reason'),
    summary: text('summary'),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    uniqueIndex('visits_appointment_uq').on(table.appointmentId),
    index('visits_patient_started_at_idx').on(table.patientId, table.startedAt),
    index('visits_clinic_status_idx').on(table.clinicId, table.status),
    enumCheck('visits_status_in_values', 'status', VISIT_STATUSES),

    // The tenant keys, the same composite `(id, clinic_id)` pair `appointments`
    // got, for the same reason (ADR 0014). The link to the appointment is
    // declared on the column above because it is the one cyclic reference.
    //
    // The two nullable ones are completed by the `BEFORE DELETE` triggers in
    // `database/migrations-sqlite/0002_tenant_key_delete_guards.sql`, because
    // SQLite has no column-list form of `ON DELETE SET NULL`.
    foreignKey({
      columns: [table.patientId, table.clinicId],
      foreignColumns: [patients.id, patients.clinicId],
      name: 'visits_patient_same_clinic_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.dentistId, table.clinicId],
      foreignColumns: [dentists.id, dentists.clinicId],
      name: 'visits_dentist_same_clinic_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.chairId, table.clinicId],
      foreignColumns: [chairs.id, chairs.clinicId],
      name: 'visits_chair_same_clinic_fk',
    }).onDelete('set null'),
  ],
);

/**
 * One row per tooth per patient per visit.
 *
 * Surfaces are stored as JSON rather than a join table: a tooth always has a
 * small, fixed set of surfaces, and the odontogram is read far more often than
 * it is written, so the array keeps the chart query to a single table.
 */
export const odontogramEntries = sqliteTable(
  'odontogram_entries',
  {
    id: text('id').primaryKey().default(uuidDefault),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    visitId: text('visit_id').references(() => visits.id, { onDelete: 'set null' }),
    dentition: text('dentition', { enum: DENTITIONS }).notNull(),
    /** FDI two-digit number stored as text: `11`..`85`. */
    tooth: text('tooth').notNull(),
    surfaces: text('surfaces', { mode: 'json' })
      .$type<(typeof ODONTOGRAM_SURFACES)[number][]>()
      .notNull()
      .default([]),
    condition: text('condition', { enum: ODONTOGRAM_CONDITIONS }).notNull(),
    notes: text('notes'),
    recordedBy: text('recorded_by'),
    recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    /**
     * A chart holds one current state per tooth (ADR — session 34): the write
     * upserts on this key, so the constraint is what makes "re-chart a tooth"
     * an update rather than a second row.
     */
    uniqueIndex('odontogram_patient_tooth_unique').on(table.patientId, table.tooth),
    index('odontogram_visit_idx').on(table.visitId),
    enumCheck('odontogram_entries_dentition_in_values', 'dentition', DENTITIONS),
    enumCheck('odontogram_entries_condition_in_values', 'condition', ODONTOGRAM_CONDITIONS),
  ],
);

export const prescriptions = sqliteTable(
  'prescriptions',
  {
    id: text('id').primaryKey().default(uuidDefault),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    dentistId: text('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    medication: text('medication').notNull(),
    dosage: text('dosage').notNull(),
    route: text('route', { enum: MEDICATION_ROUTES }).notNull(),
    frequency: text('frequency').notNull(),
    durationDays: integer('duration_days').notNull(),
    instructions: text('instructions'),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('prescriptions_visit_idx').on(table.visitId),
    check('prescriptions_duration_positive', sql`${table.durationDays} > 0`),
    enumCheck('prescriptions_route_in_values', 'route', MEDICATION_ROUTES),
  ],
);

/** Extra, non-modelled clinical notes attached to a visit. */
export const clinicalNotes = sqliteTable(
  'clinical_notes',
  {
    id: text('id').primaryKey().default(uuidDefault),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    authorId: text('author_id'),
    body: text('body').notNull(),
    /** Reserved for future structured note types; empty in the foundation. */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [index('clinical_notes_visit_idx').on(table.visitId)],
);

/**
 * Files attached to a visit — radiographs, referrals, documents.
 *
 * The bytes are not stored here (see `docs/open-questions.md` Q10); this table
 * holds the reference a clinic needs to find the file and know what it holds.
 * Tenancy comes through `visits` exactly as it does for a clinical note.
 */
export const visitAttachments = sqliteTable(
  'visit_attachments',
  {
    id: text('id').primaryKey().default(uuidDefault),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('visit_attachments_visit_idx').on(table.visitId),
    check('visit_attachments_size_nonnegative', sql`${table.sizeBytes} >= 0`),
  ],
);
