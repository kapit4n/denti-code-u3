/**
 * Billing: charges, invoices and payments.
 *
 * The SQLite twin of `database/schema/billing.ts`. Money is stored as
 * **integer minor units** with an explicit currency column on both engines —
 * there is no floating-point money anywhere in this product, because
 * `0.1 + 0.2` must never decide what a patient owes.
 *
 * `quantity` and `tax_rate_percent` are the only `numeric` columns, and they
 * are `numeric` here too (SQLite's `NUMERIC` affinity, read back as a string by
 * Drizzle — the same type the PostgreSQL column gives the application), so a
 * repository written against one engine reads the other without a cast.
 */

import {
  check,
  index,
  integer,
  numeric,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { INVOICE_STATUSES, PAYMENT_METHODS } from '@denti-code-u3/domain';

import { nowDefault, uuidDefault } from './defaults.js';
import { enumCheck } from './enum-check.js';
import { clinics, users } from './organization.js';
import { patients } from './patient.js';
import { treatments } from './treatment.js';
import { visits } from './visit.js';

export const charges = sqliteTable(
  'charges',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    visitId: text('visit_id').references(() => visits.id, { onDelete: 'set null' }),
    treatmentId: text('treatment_id').references(() => treatments.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: numeric('quantity').notNull().default('1'),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxRatePercent: numeric('tax_rate_percent').notNull().default('0'),
    currency: text('currency').notNull(),
    /** `null` means "not yet billed". */
    invoiceId: text('invoice_id'),
    /** When the charge itself was invoiced, distinct from when it was created. */
    invoicedAt: integer('invoiced_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('charges_patient_idx').on(table.patientId),
    index('charges_invoice_idx').on(table.invoiceId),
    index('charges_clinic_created_at_idx').on(table.clinicId, table.createdAt),
    check('charges_discount_not_negative', sql`${table.discountMinor} >= 0`),
  ],
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey().default(uuidDefault),
    /** Human-facing document number, e.g. `F001-00042`. */
    number: text('number'),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('DRAFT'),
    currency: text('currency').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxRatePercent: numeric('tax_rate_percent').notNull().default('0'),
    /**
     * Totals are persisted, not derived on read: an invoice is a legal document
     * and its printed total must not change if a price is edited afterwards.
     */
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    notes: text('notes'),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('invoices_patient_status_idx').on(table.patientId, table.status),
    index('invoices_clinic_issued_at_idx').on(table.clinicId, table.issuedAt),
    uniqueIndex('invoices_clinic_number_uq').on(table.clinicId, table.number),
    enumCheck('invoices_status_in_values', 'status', INVOICE_STATUSES),
  ],
);

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey().default(uuidDefault),
    number: text('number'),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    currency: text('currency').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reference: text('reference'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    receivedBy: text('received_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('payments_patient_received_at_idx').on(table.patientId, table.receivedAt),
    index('payments_clinic_received_at_idx').on(table.clinicId, table.receivedAt),
    check('payments_amount_positive', sql`${table.amountMinor} > 0`),
    enumCheck('payments_method_in_values', 'method', PAYMENT_METHODS),
  ],
);

/**
 * A payment may be split across invoices, and an invoice may be paid by several
 * payments. The composite primary key makes a duplicate split impossible.
 */
export const paymentAllocations = sqliteTable(
  'payment_allocations',
  {
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.invoiceId] }),
    check('payment_allocations_positive', sql`${table.amountMinor} > 0`),
  ],
);
