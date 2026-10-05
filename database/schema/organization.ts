/**
 * Organisation: clinics, their operating hours, rooms, chairs, users and roles.
 *
 * Multi-clinic is designed for from day one (every clinical table carries
 * `clinic_id`) but a single-clinic deployment needs no extra configuration.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { clinicRoleEnum } from './enums.js';

export const clinics = pgTable('clinics', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per weekday. `closed_at` null means the clinic does not open that day. */
export const clinicOperatingHours = pgTable(
  'clinic_operating_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday, matching JavaScript's `getDay()`. */
    dayOfWeek: integer('day_of_week').notNull(),
    opensAt: time('opens_at'),
    closesAt: time('closes_at'),
    /** Optional lunch break inside the same day. */
    breakStartsAt: time('break_starts_at'),
    breakEndsAt: time('break_ends_at'),
  },
  (table) => [
    uniqueIndex('clinic_operating_hours_clinic_day_uq').on(table.clinicId, table.dayOfWeek),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Target of the appointments' tenant foreign key: see
    // `appointments_tenant_foreign_keys` in `database/schema/appointment.ts`.
    unique('rooms_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

/** A treatment unit (sillón). Appointments may point at one. */
export const chairs = pgTable(
  'chairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Target of the appointments' tenant foreign key: see
    // `appointments_tenant_foreign_keys` in `database/schema/appointment.ts`.
    unique('chairs_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    role: clinicRoleEnum('role').notNull().default('RECEPTIONIST'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_clinic_email_uq').on(table.clinicId, table.email),
    index('users_clinic_role_idx').on(table.clinicId, table.role),
  ],
);

/**
 * A user who is also a clinician. Kept separate from `users` so that a dentist
 * is still a user (they log in) but carries clinical attributes.
 */
export const dentists = pgTable(
  'dentists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    licenceNumber: text('licence_number'),
    speciality: text('speciality'),
    color: text('color'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('dentists_clinic_active_idx').on(table.clinicId, table.isActive),
    // Target of the appointments' tenant foreign key: see
    // `appointments_tenant_foreign_keys` in `database/schema/appointment.ts`.
    unique('dentists_id_clinic_uq').on(table.id, table.clinicId),
  ],
);

/** Which permissions a role grants. Roles are fixed; permissions are explicit. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: clinicRoleEnum('role').notNull(),
    permission: text('permission').notNull(),
  },
  (table) => [primaryKey({ columns: [table.role, table.permission] })],
);

export const clinicRelations = relations(clinics, ({ many }) => ({
  operatingHours: many(clinicOperatingHours),
  rooms: many(rooms),
  users: many(users),
  dentists: many(dentists),
}));

export const chairRelations = relations(chairs, ({ one }) => ({
  clinic: one(clinics, { fields: [chairs.clinicId], references: [clinics.id] }),
  room: one(rooms, { fields: [chairs.roomId], references: [rooms.id] }),
}));

export const userRelations = relations(users, ({ one }) => ({
  clinic: one(clinics, { fields: [users.clinicId], references: [clinics.id] }),
}));

export const dentistRelations = relations(dentists, ({ one }) => ({
  clinic: one(clinics, { fields: [dentists.clinicId], references: [clinics.id] }),
  user: one(users, { fields: [dentists.userId], references: [users.id] }),
}));
