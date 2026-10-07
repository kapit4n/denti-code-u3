/**
 * Treatment catalogue and treatment plans.
 *
 * The SQLite twin of `database/schema/treatment.ts`. A `treatment` is a
 * priceable procedure the clinic offers; a `treatment_plan_item` is one line of
 * a proposal for a specific patient.
 *
 * `treatment_plan_items.surfaces` is `text[]` on PostgreSQL and JSON in a `text`
 * column here — see the same mapping in `database/schema/sqlite/visit.ts`.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { TREATMENT_PLAN_STATUSES } from '@denti-code-u3/domain';

import { nowDefault, uuidDefault } from './defaults.js';
import { enumCheck } from './enum-check.js';
import { clinics, dentists } from './organization.js';
import { patients } from './patient.js';
import { visits } from './visit.js';

export const treatments = sqliteTable(
  'treatments',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    code: text('code'),
    name: text('name').notNull(),
    description: text('description'),
    /** Base price in minor units of the clinic currency. Never a float. */
    defaultPriceMinor: integer('default_price_minor').notNull().default(0),
    /** Estimated clinical minutes, used to suggest appointment durations. */
    defaultDurationMinutes: integer('default_duration_minutes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('treatments_clinic_active_idx').on(table.clinicId, table.isActive),
    uniqueIndex('treatments_clinic_code_uq').on(table.clinicId, table.code),
  ],
);

export const treatmentPlans = sqliteTable(
  'treatment_plans',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    dentistId: text('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    status: text('status', { enum: TREATMENT_PLAN_STATUSES }).notNull().default('DRAFT'),
    title: text('title'),
    notes: text('notes'),
    presentedAt: integer('presented_at', { mode: 'timestamp_ms' }),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('treatment_plans_patient_status_idx').on(table.patientId, table.status),
    enumCheck('treatment_plans_status_in_values', 'status', TREATMENT_PLAN_STATUSES),
  ],
);

export const treatmentPlanItems = sqliteTable(
  'treatment_plan_items',
  {
    id: text('id').primaryKey().default(uuidDefault),
    treatmentPlanId: text('treatment_plan_id')
      .notNull()
      .references(() => treatmentPlans.id, { onDelete: 'cascade' }),
    treatmentId: text('treatment_id').references(() => treatments.id, { onDelete: 'set null' }),
    /** FDI tooth, when the item is tooth-specific. */
    tooth: text('tooth'),
    surfaces: text('surfaces', { mode: 'json' }).$type<string[]>().notNull().default([]),
    quantity: integer('quantity').notNull().default(1),
    estimatedPriceMinor: integer('estimated_price_minor').notNull().default(0),
    isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    notes: text('notes'),
  },
  (table) => [index('treatment_plan_items_plan_idx').on(table.treatmentPlanId)],
);

export const visitTreatmentExecutions = sqliteTable(
  'visit_treatment_executions',
  {
    id: text('id').primaryKey().default(uuidDefault),
    visitId: text('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    treatmentId: text('treatment_id')
      .notNull()
      .references(() => treatments.id, { onDelete: 'restrict' }),
    treatmentPlanItemId: text('treatment_plan_item_id').references(() => treatmentPlanItems.id, {
      onDelete: 'set null',
    }),
    tooth: text('tooth'),
    notes: text('notes'),
    performedAt: integer('performed_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [index('visit_treatment_executions_visit_idx').on(table.visitId)],
);
