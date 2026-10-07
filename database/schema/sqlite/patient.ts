/**
 * Patients and their clinical history tables.
 *
 * The SQLite twin of `database/schema/patient.ts`. Patients are never
 * hard-deleted for the same reason on both engines: clinical records must
 * remain traceable, so a patient is deactivated and, where a right to erasure
 * applies, anonymised by clearing the identifying columns.
 */

import { index, integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { clinics } from './organization.js';
import { nowDefault, uuidDefault } from './defaults.js';

export const patients = sqliteTable(
  'patients',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
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
    /** `YYYY-MM-DD`, as text: SQLite has no date type and no zone to resolve. */
    birthDate: text('birth_date'),
    address: text('address'),
    /** Free-form extras the clinic records but the domain does not model. */
    additionalData: text('additional_data', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .default({}),
    allergies: text('allergies'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Set when the patient record is anonymised; the row itself survives. */
    anonymizedAt: integer('anonymized_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('patients_clinic_last_name_idx').on(table.clinicId, table.lastName),
    index('patients_clinic_active_idx').on(table.clinicId, table.isActive),
    uniqueIndex('patients_clinic_record_number_uq').on(table.clinicId, table.recordNumber),
    // Target of the appointments' tenant foreign key. `(id, clinic_id)` is the
    // pair that makes a patient *belong to* a clinic; `id` alone is only a name.
    unique('patients_id_clinic_uq').on(table.id, table.clinicId),
  ],
);
