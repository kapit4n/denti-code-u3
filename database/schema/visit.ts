/**
 * Clinical encounters: visits and what happens inside them.
 *
 * A `visit` is the clinical record; an `appointment` is a booking. A visit may
 * exist without an appointment (walk-in), so the link is nullable — but an
 * appointment becomes a visit exactly once, which the domain enforces and the
 * unique index below backstops.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core/columns/common';

import {
  dentitionEnum,
  medicationRouteEnum,
  odontogramConditionEnum,
  odontogramSurfaceEnum,
  visitStatusEnum,
} from './enums.js';
import { appointments } from './appointment.js';
import { chairs, clinics, dentists } from './organization.js';
import { patients } from './patient.js';

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id').notNull(),
    /** Null once the clinician leaves the clinic — `on delete set null (dentist_id)`. */
    dentistId: uuid('dentist_id'),
    /** Null once the chair is removed. */
    chairId: uuid('chair_id'),
    /**
     * Null only for a walk-in. When present it must name a real appointment, and it
     * is unique — an appointment becomes a visit exactly once (ADR 0021).
     *
     * `.references()` rather than the `foreignKey()` helper below, and the reason is
     * load order rather than preference: `visit.ts` and `appointment.ts` now reference
     * each other, and `foreignKey({ foreignColumns: [appointments.id] })` reads that
     * binding while `appointment.ts` is still half-evaluated. The arrow defers it to
     * migration generation, so neither file needs to know which one loads first.
     *
     * `restrict` rather than `set null`: an appointment with a visit is not deleted, it
     * is cancelled. Nulling this would turn a treated visit into something that reads
     * as a walk-in, which is a different clinical fact.
     */
    appointmentId: uuid('appointment_id').references((): AnyPgColumn => appointments.id, {
      onDelete: 'restrict',
    }),
    status: visitStatusEnum('status').notNull().default('OPEN'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    reason: text('reason'),
    summary: text('summary'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('visits_appointment_uq').on(table.appointmentId),
    index('visits_patient_started_at_idx').on(table.patientId, table.startedAt),
    index('visits_clinic_status_idx').on(table.clinicId, table.status),

    // The tenant keys. The link to the appointment is declared on the column above,
    // because it is the one reference here that is cyclic (see that comment).
    //
    // Tenant foreign keys, the same composite `(id, clinic_id)` pair that
    // `appointments` got in migration 0002 and for the same reason (ADR 0014): a key
    // on the id alone proves the row exists and says nothing about whose it is, so a
    // visit could hold another clinic's patient (ADR 0021).
    //
    // The two nullable ones need `set null (column)` — a dentist who has left the
    // clinic must not take their visits with them, and without the column list the
    // delete would try to null `clinic_id` too and be refused by its own NOT NULL.
    // That form is PostgreSQL 15+; docker-compose.yml pins 17, and migration 0003
    // carries the same hand-edit.
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
 * Surfaces are stored in a text array (not a join table): a tooth always has a
 * small, fixed set of surfaces, and the odontogram is read far more often than
 * it is written, so the array keeps the chart query to a single table.
 */
export const odontogramEntries = pgTable(
  'odontogram_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    visitId: uuid('visit_id').references(() => visits.id, { onDelete: 'set null' }),
    dentition: dentitionEnum('dentition').notNull(),
    /** FDI two-digit number stored as text: `11`..`85`. */
    tooth: text('tooth').notNull(),
    surfaces: odontogramSurfaceEnum('surfaces').array().notNull().default([]),
    condition: odontogramConditionEnum('condition').notNull(),
    notes: text('notes'),
    recordedBy: uuid('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('odontogram_patient_tooth_idx').on(table.patientId, table.tooth),
    index('odontogram_visit_idx').on(table.visitId),
  ],
);

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    dentistId: uuid('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    medication: text('medication').notNull(),
    dosage: text('dosage').notNull(),
    route: medicationRouteEnum('route').notNull(),
    frequency: text('frequency').notNull(),
    durationDays: integer('duration_days').notNull(),
    instructions: text('instructions'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('prescriptions_visit_idx').on(table.visitId),
    check('prescriptions_duration_positive', sql`${table.durationDays} > 0`),
  ],
);

/** Extra, non-modelled clinical notes attached to a visit. */
export const clinicalNotes = pgTable(
  'clinical_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    /** Reserved for future structured note types; empty in the foundation. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('clinical_notes_visit_idx').on(table.visitId)],
);

/**
 * Files attached to a visit — radiographs, referrals, documents.
 *
 * The bytes are not stored here: `docs/open-questions.md` (Q10) leaves storage
 * to a later milestone, and this table holds the reference a clinic needs to
 * find the file and know what it holds. Tenancy comes through `visits` exactly
 * as it does for a clinical note — no `clinic_id`, the visit *is* the tenant key.
 */
export const visitAttachments = pgTable(
  'visit_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('visit_attachments_visit_idx').on(table.visitId),
    check('visit_attachments_size_nonnegative', sql`${table.sizeBytes} >= 0`),
  ],
);

export const visitRelations = relations(visits, ({ one, many }) => ({
  clinic: one(clinics, { fields: [visits.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [visits.patientId], references: [patients.id] }),
  dentist: one(dentists, { fields: [visits.dentistId], references: [dentists.id] }),
  chair: one(chairs, { fields: [visits.chairId], references: [chairs.id] }),
  appointment: one(appointments, {
    fields: [visits.appointmentId],
    references: [appointments.id],
  }),
  prescriptions: many(prescriptions),
  odontogramEntries: many(odontogramEntries),
}));

export const odontogramEntryRelations = relations(odontogramEntries, ({ one }) => ({
  patient: one(patients, { fields: [odontogramEntries.patientId], references: [patients.id] }),
  visit: one(visits, { fields: [odontogramEntries.visitId], references: [visits.id] }),
}));

export const visitAttachmentRelations = relations(visitAttachments, ({ one }) => ({
  visit: one(visits, { fields: [visitAttachments.visitId], references: [visits.id] }),
}));
