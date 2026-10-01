/**
 * Treatment catalogue and treatment plans.
 *
 * A `treatment` is a priceable procedure the clinic offers. A
 * `treatment_plan_item` is one line of a proposal for a specific patient.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { treatmentPlanStatusEnum } from './enums.js';
import { patients } from './patient.js';
import { clinics, dentists } from './organization.js';
import { visits } from './visit.js';

export const treatments = pgTable(
  'treatments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'),
    /** Base price in minor units of the clinic currency. Never a float. */
    defaultPriceMinor: integer('default_price_minor').notNull().default(0),
    /** Estimated clinical minutes, used to suggest appointment durations. */
    defaultDurationMinutes: integer('default_duration_minutes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('treatments_clinic_active_idx').on(table.clinicId, table.isActive),
    uniqueIndex('treatments_clinic_code_uq').on(table.clinicId, table.code),
  ],
);

export const treatmentPlans = pgTable(
  'treatment_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    dentistId: uuid('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    status: treatmentPlanStatusEnum('status').notNull().default('DRAFT'),
    title: text('title'),
    notes: text('notes'),
    presentedAt: timestamp('presented_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('treatment_plans_patient_status_idx').on(table.patientId, table.status)],
);

export const treatmentPlanItems = pgTable(
  'treatment_plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    treatmentPlanId: uuid('treatment_plan_id')
      .notNull()
      .references(() => treatmentPlans.id, { onDelete: 'cascade' }),
    treatmentId: uuid('treatment_id').references(() => treatments.id, { onDelete: 'set null' }),
    /** FDI tooth, when the item is tooth-specific. */
    tooth: text('tooth'),
    surfaces: text('surfaces').array().notNull().default([]),
    quantity: integer('quantity').notNull().default(1),
    estimatedPriceMinor: integer('estimated_price_minor').notNull().default(0),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (table) => [index('treatment_plan_items_plan_idx').on(table.treatmentPlanId)],
);

export const treatmentRelations = relations(treatments, ({ one }) => ({
  clinic: one(clinics, { fields: [treatments.clinicId], references: [clinics.id] }),
}));

export const treatmentPlanRelations = relations(treatmentPlans, ({ one, many }) => ({
  clinic: one(clinics, { fields: [treatmentPlans.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [treatmentPlans.patientId], references: [patients.id] }),
  dentist: one(dentists, { fields: [treatmentPlans.dentistId], references: [dentists.id] }),
  items: many(treatmentPlanItems),
}));

export const treatmentPlanItemRelations = relations(treatmentPlanItems, ({ one }) => ({
  plan: one(treatmentPlans, {
    fields: [treatmentPlanItems.treatmentPlanId],
    references: [treatmentPlans.id],
  }),
  treatment: one(treatments, {
    fields: [treatmentPlanItems.treatmentId],
    references: [treatments.id],
  }),
}));

export const visitTreatmentExecutions = pgTable(
  'visit_treatment_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    treatmentId: uuid('treatment_id')
      .notNull()
      .references(() => treatments.id, { onDelete: 'restrict' }),
    treatmentPlanItemId: uuid('treatment_plan_item_id').references(() => treatmentPlanItems.id, {
      onDelete: 'set null',
      // Drizzle derives this name by joining table and column names, which is 75
      // characters long; PostgreSQL truncates identifiers to 63 and emits a
      // NOTICE while creating the table. Drizzle Kit ignores constraint names
      // when diffing, and nothing reads the name at runtime, so the truncated
      // name is left alone rather than renamed — a shorter name in the
      // migration would differ from the snapshot without fixing anything.
    }),
    tooth: text('tooth'),
    notes: text('notes'),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('visit_treatment_executions_visit_idx').on(table.visitId)],
);
