/**
 * Billing: charges, invoices and payments.
 *
 * Money is stored as **integer minor units** (cents) with an explicit currency
 * column. There is no floating-point money anywhere in this database, because
 * `0.1 + 0.2` must never decide what a patient owes.
 *
 * A `charge` may exist with no invoice (treatment done, billed later), so the
 * link is nullable. A `payment` may be unallocated (cash on the counter before
 * anyone knows which invoice it settles), so allocations are a separate table.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { invoiceStatusEnum, paymentMethodEnum } from './enums.js';
import { clinics, users } from './organization.js';
import { patients } from './patient.js';
import { treatments } from './treatment.js';
import { visits } from './visit.js';

export const charges = pgTable(
  'charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    visitId: uuid('visit_id').references(() => visits.id, { onDelete: 'set null' }),
    treatmentId: uuid('treatment_id').references(() => treatments.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull(),
    /** `null` means "not yet billed". */
    invoiceId: uuid('invoice_id'),
    /** When the charge itself was invoiced, distinct from when it was created. */
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('charges_patient_idx').on(table.patientId),
    index('charges_invoice_idx').on(table.invoiceId),
    index('charges_clinic_created_at_idx').on(table.clinicId, table.createdAt),
    check('charges_discount_not_negative', sql`${table.discountMinor} >= 0`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-facing document number, e.g. `F001-00042`. */
    number: text('number'),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    status: invoiceStatusEnum('status').notNull().default('DRAFT'),
    currency: text('currency').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    /**
     * Totals are persisted, not derived on read: an invoice is a legal document
     * and its printed total must not change if a price is edited afterwards.
     */
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    notes: text('notes'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoices_patient_status_idx').on(table.patientId, table.status),
    index('invoices_clinic_issued_at_idx').on(table.clinicId, table.issuedAt),
    uniqueIndex('invoices_clinic_number_uq').on(table.clinicId, table.number),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number'),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    method: paymentMethodEnum('method').notNull(),
    currency: text('currency').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reference: text('reference'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('payments_patient_received_at_idx').on(table.patientId, table.receivedAt),
    index('payments_clinic_received_at_idx').on(table.clinicId, table.receivedAt),
    check('payments_amount_positive', sql`${table.amountMinor} > 0`),
  ],
);

/**
 * A payment may be split across invoices, and an invoice may be paid by several
 * payments. The composite primary key makes a duplicate split impossible.
 */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.invoiceId] }),
    check('payment_allocations_positive', sql`${table.amountMinor} > 0`),
  ],
);

export const chargeRelations = relations(charges, ({ one }) => ({
  clinic: one(clinics, { fields: [charges.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [charges.patientId], references: [patients.id] }),
  visit: one(visits, { fields: [charges.visitId], references: [visits.id] }),
  treatment: one(treatments, { fields: [charges.treatmentId], references: [treatments.id] }),
  invoice: one(invoices, { fields: [charges.invoiceId], references: [invoices.id] }),
}));

export const invoiceRelations = relations(invoices, ({ one, many }) => ({
  clinic: one(clinics, { fields: [invoices.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [invoices.patientId], references: [patients.id] }),
  charges: many(charges),
  allocations: many(paymentAllocations),
}));

export const paymentRelations = relations(payments, ({ one, many }) => ({
  clinic: one(clinics, { fields: [payments.clinicId], references: [clinics.id] }),
  patient: one(patients, { fields: [payments.patientId], references: [patients.id] }),
  allocations: many(paymentAllocations),
}));

export const paymentAllocationRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, { fields: [paymentAllocations.paymentId], references: [payments.id] }),
  invoice: one(invoices, {
    fields: [paymentAllocations.invoiceId],
    references: [invoices.id],
  }),
}));
