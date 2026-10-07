/**
 * Organisation: clinics, their operating hours, rooms, chairs, users and roles.
 *
 * The SQLite twin of `database/schema/organization.ts`. The two are kept in the
 * same bounded areas, table for table, so a column added to one is a compile
 * error against the other (ADR 0025). Differences, all of them forced by
 * SQLite's type system rather than chosen:
 *
 *  - `uuid` is `text`; ids come from the application's `IdGenerator`, with the
 *    v4-shaped default in `defaults.ts` as the backstop.
 *  - `timestamptz` is `integer` in epoch **milliseconds**, UTC. Milliseconds
 *    rather than seconds because that is what `Date.getTime()` produces, so the
 *    driver never has to scale a value and never has to decide a zone.
 *  - `time` is `text`: SQLite has no time type, and `HH:MM` sorts correctly as
 *    text.
 *  - `clinic_role` is `text` carrying the same value list. SQLite has no enum
 *    type; the list is attached to the column so Drizzle types it identically.
 *
 * `relations()` is deliberately not mirrored. Nothing in this codebase uses
 * Drizzle's relational query API — every read is an explicit join in a
 * repository — so a second set would be code with no caller.
 */

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { CLINIC_ROLES } from '@denti-code-u3/domain';

import { nowDefault, uuidDefault } from './defaults.js';
import { enumCheck } from './enum-check.js';

export const clinics = sqliteTable('clinics', {
  id: text('id').primaryKey().default(uuidDefault),
  name: text('name').notNull(),
  /** Legal/trade name, shown on invoices. */
  legalName: text('legal_name'),
  taxId: text('tax_id'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  /** IANA zone, e.g. `America/Lima`. All clinic-day maths uses this. */
  timeZone: text('time_zone').notNull().default('America/Lima'),
  currencyCode: text('currency_code').notNull().default('USD'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
});

/** One row per weekday. A null `opens_at` means the clinic does not open that day. */
export const clinicOperatingHours = sqliteTable(
  'clinic_operating_hours',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday, matching JavaScript's `getDay()`. */
    dayOfWeek: integer('day_of_week').notNull(),
    opensAt: text('opens_at'),
    closesAt: text('closes_at'),
    /** Optional lunch break inside the same day. */
    breakStartsAt: text('break_starts_at'),
    breakEndsAt: text('break_ends_at'),
  },
  (table) => [
    uniqueIndex('clinic_operating_hours_clinic_day_uq').on(table.clinicId, table.dayOfWeek),
  ],
);

export const rooms = sqliteTable(
  'rooms',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    // Target of the appointments' tenant foreign key: see
    // `appointments_tenant_foreign_keys` in `database/schema/sqlite/appointment.ts`.
    unique('rooms_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

/** A treatment unit (sillón). Appointments may point at one. */
export const chairs = sqliteTable(
  'chairs',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    roomId: text('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    // Target of the appointments' tenant foreign key: see
    // `appointments_tenant_foreign_keys` in `database/schema/sqlite/appointment.ts`.
    unique('chairs_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    role: text('role', { enum: CLINIC_ROLES }).notNull().default('RECEPTIONIST'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    uniqueIndex('users_clinic_email_uq').on(table.clinicId, table.email),
    index('users_clinic_role_idx').on(table.clinicId, table.role),
    enumCheck('users_role_in_values', 'role', CLINIC_ROLES),
  ],
);

/**
 * A user who is also a clinician. Kept separate from `users` so that a dentist
 * is still a user (they log in) but carries clinical attributes.
 */
export const dentists = sqliteTable(
  'dentists',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    licenceNumber: text('licence_number'),
    speciality: text('speciality'),
    color: text('color'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('dentists_clinic_active_idx').on(table.clinicId, table.isActive),
    // Target of the appointments' and visits' tenant foreign key: see
    // `appointments_tenant_foreign_keys` in `database/schema/sqlite/appointment.ts`.
    unique('dentists_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

/** Which permissions a role grants. Roles are fixed; permissions are explicit. */
export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    role: text('role', { enum: CLINIC_ROLES }).notNull(),
    permission: text('permission').notNull(),
  },
  (table) => [primaryKey({ columns: [table.role, table.permission] })],
);
