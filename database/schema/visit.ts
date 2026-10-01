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
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    dentistId: uuid('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    chairId: uuid('chair_id').references(() => chairs.id, { onDelete: 'set null' }),
    /** Unique when present: an appointment becomes a visit exactly once. */
    appointmentId: uuid('appointment_id'),
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
