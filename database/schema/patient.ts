/**
 * Patients and their clinical history tables.
 *
 * Patients are never hard-deleted: clinical records must remain traceable, so a
 * patient is deactivated (`is_active = false`) and, where a right to erasure
 * applies, anonymised by clearing the identifying columns.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { clinics } from './organization.js';

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'restrict' }),
    /** Human-facing record number, unique per clinic (e.g. `P-000123`). */
    recordNumber: text('record_number'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'),
    /** DNI / national id. Not unique: a number can be reissued. */
    identificationNumber: text('identification_number'),
    /** Encrypted at rest; never returned by list endpoints. */
    phone: text('phone'),
    email: text('email'),
    birthDate: date('birth_date', { mode: 'string' }),
    address: text('address'),
    /** Free-form extras the clinic records but the domain does not model. */
    additionalData: jsonb('additional_data').$type<Record<string, unknown>>().default({}),
    allergies: text('allergies'),
    isActive: boolean('is_active').notNull().default(true),
    /** Set when the patient record is anonymised; the row itself survives. */
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('patients_clinic_last_name_idx').on(table.clinicId, table.lastName),
    index('patients_clinic_active_idx').on(table.clinicId, table.isActive),
    uniqueIndex('patients_clinic_record_number_uq').on(table.clinicId, table.recordNumber),
    // Target of the appointments' tenant foreign key. `(id, clinic_id)` is the
    // pair that makes a patient *belong to* a clinic; `id` alone is only a name,
    // and a foreign key on it cannot tell clinic B's patient from clinic A's.
    unique('patients_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

export const patientRelations = relations(patients, ({ one }) => ({
  clinic: one(clinics, { fields: [patients.clinicId], references: [clinics.id] }),
}));
