/**
 * Development seed data, on both engines (ADR 0025).
 *
 * Idempotent: every insert is keyed by a fixed id and uses `onConflictDoNothing`,
 * so running the seed twice leaves the same database. It never runs against a
 * production URL — `ALLOW_PRODUCTION_SEED` must be set explicitly, because
 * seeding real patient data would be unrecoverable.
 *
 * The clinic id is a fixed constant rather than a generated one, because
 * `CLINIC_ID` in `.env` has to match it. A generated id would print a value the
 * developer then has to copy into `.env`, and a stale `.env` would silently scope
 * the whole API to a clinic that does not exist.
 *
 * The engine is chosen by the `DATABASE_URL` scheme. Because the two schemas are
 * separate modules with separate types, the seed body is written once per engine
 * (`seedPostgres` / `seedSqlite`) over the same ids and labels, exactly as the
 * repository methods are (ADR 0025). The values are kept aligned by the fixed
 * ids in them and by the integration tests both engines must pass.
 */

import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import Database from 'better-sqlite3';
import { drizzle as sqliteDrizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isSqliteUrl, sqliteDatabasePath, ensureSqliteDatabaseDirectory } from './db-url.js';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@denti-code-u3/database/schema';
import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';

/** Must match `CLINIC_ID` in `.env.example`. */
export const DEVELOPMENT_CLINIC_ID = '11111111-1111-4111-8111-111111111111';

/**
 * The development login the seeded clinic ships with.
 *
 * An administrator and a receptionist, plus a user for each dentist so a clinician
 * has an account of their own. The password is the same for all four and is
 * printed by `pnpm run db:seed`; it is a **development credential only** and the
 * seed refuses to run against a database whose URL looks like production.
 */
export const DEVELOPMENT_USERS = [
  {
    id: '11111111-3333-4444-8555-000000000001',
    email: 'admin@denti-code.test',
    fullName: 'Ada Administradora',
    role: 'ADMINISTRATOR',
    /** Links this user to the seeded dentist with the matching id, if any. */
    dentistId: undefined as string | undefined,
  },
  {
    id: '11111111-3333-4444-8555-000000000002',
    email: 'recepcion@denti-code.test',
    fullName: 'Rita Recepción',
    role: 'RECEPTIONIST',
    dentistId: undefined as string | undefined,
  },
  {
    id: '11111111-3333-4444-8555-000000000003',
    email: 'elena.vargas@denti-code.test',
    fullName: 'Dr. Elena Vargas',
    role: 'DENTIST',
    dentistId: '11111111-2222-4333-8444-000000000001' as string | undefined,
  },
  {
    id: '11111111-3333-4444-8555-000000000004',
    email: 'marco.salas@denti-code.test',
    fullName: 'Dr. Marco Salas',
    role: 'DENTIST',
    dentistId: '11111111-2222-4333-8444-000000000002' as string | undefined,
  },
] as const;

/** The password every seeded development user shares. Printed by the seed. */
export const DEVELOPMENT_PASSWORD = 'denti-code-dev';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(78);
}

if (databaseUrl.includes('prod') && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  console.error('Refusing to seed a database whose URL looks like production.');
  process.exit(78);
}

/** Monday to Friday, 08:00-17:00 with a lunch break — the capacity the dashboard divides by. */
const WEEKDAY_HOURS = [1, 2, 3, 4, 5] as const;

const timeZone = process.env.CLINIC_TIMEZONE ?? 'America/Argentina/Buenos_Aires';
const currencyCode = 'USD';

const now = new Date();

/**
 * Hash a password the way the API's `ScryptPasswordHasher` does.
 *
 * Duplicated here rather than imported from `apps/api`, because the seed is part
 * of `database/` and must not depend on the API process. The format is the
 * contract (`scrypt$N$r$p$salt$hash`), and the API's own test proves it verifies
 * hashes in exactly this shape.
 */
async function hashPassword(password: string): Promise<string> {
  const { randomBytes, scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem: number },
  ) => Promise<Buffer>;
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), derived.toString('base64')].join('$');
}

function seedSummary(): string {
  return `clinic ${DEVELOPMENT_CLINIC_ID}, 10 patients, 2 dentists, 2 rooms, 4 chairs, 10 appointments, 10 visits (8 completed, 1 open, 1 cancelled), 1 plan (2 items), 4 treatments, 2 treatment executions, 1 clinical note, 1 prescription, 2 attachments, 10 odontogram entries, 3 charges, 2 payments`;
}

/**
 * Seeds one clinic with enough related data to exercise the dashboard and the
 * patient profile without hand-crafting a database.
 */
async function seedPostgres(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  const { clinics, clinicOperatingHours } = pgSchema;

  await db
    .insert(clinics)
    .values({
      id: DEVELOPMENT_CLINIC_ID,
      name: 'Denti-Code Development Clinic',
      timeZone,
      currencyCode,
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(clinicOperatingHours)
    .values(
      WEEKDAY_HOURS.map((dayOfWeek) => ({
        clinicId: DEVELOPMENT_CLINIC_ID,
        dayOfWeek,
        opensAt: '08:00',
        closesAt: '17:00',
        breakStartsAt: '13:00',
        breakEndsAt: '14:00',
      })),
    )
    .onConflictDoNothing();

  await insertUsersPg(db);
  await insertDentistsPg(db);
  await insertRoomsAndChairsPg(db);
  await insertPatientsPg(db);
  await insertAppointmentsPg(db);
  await insertTreatmentsPg(db);
  await insertVisitsAndPlansPg(db);
  await insertChargesPg(db);
  await insertPaymentsPg(db);
}

/** The SQLite twin of `seedPostgres`, against `database/schema/sqlite`. */
async function seedSqlite(db: BetterSQLite3Database<typeof sqliteSchema>): Promise<void> {
  const { clinics, clinicOperatingHours } = sqliteSchema;

  await db
    .insert(clinics)
    .values({
      id: DEVELOPMENT_CLINIC_ID,
      name: 'Denti-Code Development Clinic',
      timeZone,
      currencyCode,
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(clinicOperatingHours)
    .values(
      WEEKDAY_HOURS.map((dayOfWeek) => ({
        clinicId: DEVELOPMENT_CLINIC_ID,
        dayOfWeek,
        opensAt: '08:00',
        closesAt: '17:00',
        breakStartsAt: '13:00',
        breakEndsAt: '14:00',
      })),
    )
    .onConflictDoNothing();

  await insertUsersSqlite(db);
  await insertDentistsSqlite(db);
  await insertRoomsAndChairsSqlite(db);
  await insertPatientsSqlite(db);
  await insertAppointmentsSqlite(db);
  await insertTreatmentsSqlite(db);
  await insertVisitsAndPlansSqlite(db);
  await insertChargesSqlite(db);
  await insertPaymentsSqlite(db);
}

async function insertUsersPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  const passwordHash = await hashPassword(DEVELOPMENT_PASSWORD);
  await db
    .insert(pgSchema.users)
    .values(
      DEVELOPMENT_USERS.map((user) => ({
        id: user.id,
        clinicId: DEVELOPMENT_CLINIC_ID,
        email: user.email,
        passwordHash,
        fullName: user.fullName,
        role: user.role,
        isActive: true,
      })),
    )
    .onConflictDoNothing();
}

async function insertUsersSqlite(db: BetterSQLite3Database<typeof sqliteSchema>): Promise<void> {
  const passwordHash = await hashPassword(DEVELOPMENT_PASSWORD);
  await db
    .insert(sqliteSchema.users)
    .values(
      DEVELOPMENT_USERS.map((user) => ({
        id: user.id,
        clinicId: DEVELOPMENT_CLINIC_ID,
        email: user.email,
        passwordHash,
        fullName: user.fullName,
        role: user.role,
        isActive: true,
      })),
    )
    .onConflictDoNothing();
}

async function insertDentistsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.dentists)
    .values([
      {
        id: '11111111-2222-4333-8444-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        userId: '11111111-3333-4444-8555-000000000003',
        fullName: 'Dr. Elena Vargas',
        speciality: 'General dentistry',
        isActive: true,
      },
      {
        id: '11111111-2222-4333-8444-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        userId: '11111111-3333-4444-8555-000000000004',
        fullName: 'Dr. Marco Salas',
        speciality: 'Endodontics',
        isActive: true,
      },
    ])
    .onConflictDoNothing();
}

async function insertDentistsSqlite(db: BetterSQLite3Database<typeof sqliteSchema>): Promise<void> {
  await db
    .insert(sqliteSchema.dentists)
    .values([
      {
        id: '11111111-2222-4333-8444-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        userId: '11111111-3333-4444-8555-000000000003',
        fullName: 'Dr. Elena Vargas',
        speciality: 'General dentistry',
        isActive: true,
      },
      {
        id: '11111111-2222-4333-8444-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        userId: '11111111-3333-4444-8555-000000000004',
        fullName: 'Dr. Marco Salas',
        speciality: 'Endodontics',
        isActive: true,
      },
    ])
    .onConflictDoNothing();
}

// Rooms and chairs exist in the seed because `GET /api/v1/chairs` has to answer
// something in development, and because an agenda whose blocks all say "No chair
// assigned" is not the picture a receptionist works from.
//
// Two rooms, four chairs, and the appointments below are seated in them without
// ever overlapping inside one room: `appointments_room_no_overlap` treats a room as
// exclusive, so two chairs in `Aula 1` cannot hold two appointments at once. That
// constraint is worth a second look — a room with two chairs exists precisely so
// both can be working — but changing an exclusion constraint is a migration and a
// product decision, not something a seed should quietly work around by giving
// every chair its own room. Recorded in `docs/open-questions.md`.
const ROOMS = [
  {
    id: '11111111-3333-4444-8555-000000000001',
    clinicId: DEVELOPMENT_CLINIC_ID,
    name: 'Aula 1',
  },
  {
    id: '11111111-3333-4444-8555-000000000002',
    clinicId: DEVELOPMENT_CLINIC_ID,
    name: 'Aula 2',
  },
] as const;

const CHAIRS = [
  {
    id: '11111111-4444-4555-8666-000000000001',
    clinicId: DEVELOPMENT_CLINIC_ID,
    roomId: '11111111-3333-4444-8555-000000000001',
    name: 'Sillón 1',
  },
  {
    id: '11111111-4444-4555-8666-000000000002',
    clinicId: DEVELOPMENT_CLINIC_ID,
    roomId: '11111111-3333-4444-8555-000000000001',
    name: 'Sillón 2',
  },
  {
    id: '11111111-4444-4555-8666-000000000003',
    clinicId: DEVELOPMENT_CLINIC_ID,
    roomId: '11111111-3333-4444-8555-000000000002',
    name: 'Sillón 3',
  },
  // Out of service, and still listed. The name says what the chair *is* and
  // `isActive` says what is true of it — a status written into a name is a second
  // source of truth, and renaming the chair would have to edit the status too.
  {
    id: '11111111-4444-4555-8666-000000000004',
    clinicId: DEVELOPMENT_CLINIC_ID,
    roomId: null,
    name: 'Sillón 4',
    isActive: false,
  },
] as const;

async function insertRoomsAndChairsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.rooms)
    .values([...ROOMS])
    .onConflictDoNothing();
  await db
    .insert(pgSchema.chairs)
    .values([...CHAIRS])
    .onConflictDoNothing();
}

async function insertRoomsAndChairsSqlite(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): Promise<void> {
  await db
    .insert(sqliteSchema.rooms)
    .values([...ROOMS])
    .onConflictDoNothing();
  await db
    .insert(sqliteSchema.chairs)
    .values([...CHAIRS])
    .onConflictDoNothing();
}

const PATIENTS = [
  {
    id: '11111111-3333-4444-8555-000000000001',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000001',
    firstName: 'Ana',
    lastName: 'García',
    phone: '+1 555 0101',
    email: 'ana.garcia@example.test',
    birthDate: '1991-04-17',
    allergies: 'Penicillin',
  },
  {
    id: '11111111-3333-4444-8555-000000000002',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000002',
    firstName: 'Luis',
    lastName: 'Fernández',
    phone: '+1 555 0102',
    email: 'luis.fernandez@example.test',
    birthDate: '1985-11-02',
  },
  // Retired record: proves the list and profile handle inactive patients
  // instead of assuming every row is current.
  {
    id: '11111111-3333-4444-8555-000000000003',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000003',
    firstName: 'Sofía',
    lastName: 'Ramírez',
    birthDate: '1979-06-30',
    isActive: false,
  },
  // Seven more current records, so the list, the picker and the dashboard's
  // "recent patients" card have a page rather than a handful of rows.
  {
    id: '11111111-3333-4444-8555-000000000004',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000004',
    firstName: 'Diego',
    lastName: 'Rojas',
    phone: '+1 555 0104',
    email: 'diego.rojas@example.test',
    birthDate: '1998-01-23',
  },
  {
    id: '11111111-3333-4444-8555-000000000005',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000005',
    firstName: 'Valeria',
    lastName: 'Mendoza',
    phone: '+1 555 0105',
    email: 'valeria.mendoza@example.test',
    birthDate: '1994-08-09',
    allergies: 'Latex',
  },
  {
    id: '11111111-3333-4444-8555-000000000006',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000006',
    firstName: 'Tomás',
    lastName: 'Herrera',
    phone: '+1 555 0106',
    email: 'tomas.herrera@example.test',
    birthDate: '2001-12-05',
  },
  {
    id: '11111111-3333-4444-8555-000000000007',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000007',
    firstName: 'Camila',
    lastName: 'Ortiz',
    phone: '+1 555 0107',
    email: 'camila.ortiz@example.test',
    birthDate: '1988-03-14',
  },
  {
    id: '11111111-3333-4444-8555-000000000008',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000008',
    firstName: 'Mateo',
    lastName: 'Ríos',
    phone: '+1 555 0108',
    email: 'mateo.rios@example.test',
    birthDate: '1972-07-28',
  },
  {
    id: '11111111-3333-4444-8555-000000000009',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000009',
    firstName: 'Lucía',
    lastName: 'Castro',
    phone: '+1 555 0109',
    email: 'lucia.castro@example.test',
    birthDate: '1996-10-11',
  },
  {
    id: '11111111-3333-4444-8555-00000000000a',
    clinicId: DEVELOPMENT_CLINIC_ID,
    recordNumber: 'P-000010',
    firstName: 'Andrés',
    lastName: 'Paredes',
    phone: '+1 555 0110',
    email: 'andres.paredes@example.test',
    birthDate: '1983-05-19',
  },
] as const;

async function insertPatientsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.patients)
    .values([...PATIENTS])
    .onConflictDoNothing();
}

async function insertPatientsSqlite(db: BetterSQLite3Database<typeof sqliteSchema>): Promise<void> {
  await db
    .insert(sqliteSchema.patients)
    .values([...PATIENTS])
    .onConflictDoNothing();
}

/**
 * Appointments are placed relative to *now* in the clinic's own day, so the
 * dashboard has rows to report whenever the seed is run. A fixed timestamp
 * would put every appointment in the past within a day.
 */
const at = (dayOffset: number, hour: number, minute: number): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);

const APPOINTMENTS = [
  {
    id: '11111111-4444-4555-8666-000000000001',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000001',
    dentistId: '11111111-2222-4333-8444-000000000001',
    chairId: '11111111-4444-4555-8666-000000000001',
    roomId: '11111111-3333-4444-8555-000000000001',
    startsAt: at(0, 9, 0),
    durationMinutes: 45,
    status: 'CONFIRMED',
  },
  {
    id: '11111111-4444-4555-8666-000000000002',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000002',
    dentistId: '11111111-2222-4333-8444-000000000001',
    // 10:00 follows the 09:00–09:45 above without touching it, so the two can
    // share `Aula 1` without the room exclusion constraint objecting.
    chairId: '11111111-4444-4555-8666-000000000002',
    roomId: '11111111-3333-4444-8555-000000000001',
    startsAt: at(0, 10, 0),
    durationMinutes: 60,
    status: 'SCHEDULED',
  },
  {
    id: '11111111-4444-4555-8666-000000000003',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000001',
    dentistId: '11111111-2222-4333-8444-000000000002',
    chairId: '11111111-4444-4555-8666-000000000003',
    roomId: '11111111-3333-4444-8555-000000000002',
    startsAt: at(0, 11, 30),
    durationMinutes: 30,
    status: 'ARRIVED',
  },
  {
    id: '11111111-4444-4555-8666-000000000004',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000002',
    dentistId: '11111111-2222-4333-8444-000000000001',
    chairId: '11111111-4444-4555-8666-000000000001',
    roomId: '11111111-3333-4444-8555-000000000001',
    // Three days out, at a normal clinic hour rather than the seed's run time.
    startsAt: at(3, 9, 0),
    durationMinutes: 45,
    status: 'SCHEDULED',
  },
  // Six more bookings: three still today (one finished, one cancelled, one later),
  // two tomorrow and one in three days, so the agenda and the dashboard's preview
  // have a week rather than a single column. Rooms do not overlap.
  {
    id: '11111111-4444-4555-8666-000000000005',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000004',
    dentistId: '11111111-2222-4333-8444-000000000002',
    chairId: '11111111-4444-4555-8666-000000000003',
    roomId: '11111111-3333-4444-8555-000000000002',
    startsAt: at(0, 14, 0),
    durationMinutes: 45,
    status: 'COMPLETED',
  },
  {
    id: '11111111-4444-4555-8666-000000000006',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000005',
    dentistId: '11111111-2222-4333-8444-000000000001',
    chairId: '11111111-4444-4555-8666-000000000001',
    roomId: '11111111-3333-4444-8555-000000000001',
    startsAt: at(0, 15, 0),
    durationMinutes: 30,
    status: 'CANCELLED',
  },
  {
    id: '11111111-4444-4555-8666-000000000007',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000006',
    dentistId: '11111111-2222-4333-8444-000000000002',
    chairId: '11111111-4444-4555-8666-000000000003',
    roomId: '11111111-3333-4444-8555-000000000002',
    startsAt: at(0, 16, 0),
    durationMinutes: 45,
    status: 'SCHEDULED',
  },
  {
    id: '11111111-4444-4555-8666-000000000008',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000007',
    dentistId: '11111111-2222-4333-8444-000000000001',
    chairId: '11111111-4444-4555-8666-000000000001',
    roomId: '11111111-3333-4444-8555-000000000001',
    startsAt: at(1, 9, 0),
    durationMinutes: 60,
    status: 'CONFIRMED',
  },
  {
    id: '11111111-4444-4555-8666-000000000009',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000008',
    dentistId: '11111111-2222-4333-8444-000000000002',
    chairId: '11111111-4444-4555-8666-000000000003',
    roomId: '11111111-3333-4444-8555-000000000002',
    startsAt: at(1, 11, 0),
    durationMinutes: 30,
    status: 'SCHEDULED',
  },
  {
    id: '11111111-4444-4555-8666-000000000010',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000009',
    dentistId: '11111111-2222-4333-8444-000000000002',
    chairId: '11111111-4444-4555-8666-000000000003',
    roomId: '11111111-3333-4444-8555-000000000002',
    startsAt: at(3, 10, 0),
    durationMinutes: 45,
    status: 'CONFIRMED',
  },
] satisfies readonly AppointmentInput[];

type AppointmentInput = typeof pgSchema.appointments.$inferInsert;

async function insertAppointmentsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.appointments)
    .values([...APPOINTMENTS])
    .onConflictDoNothing();
}

/**
 * The SQLite twin of `insertAppointmentsPg`, with a pre-filter the PostgreSQL
 * `ON CONFLICT DO NOTHING` makes unnecessary there.
 *
 * SQLite's overlap guard is a `BEFORE INSERT` trigger, which fires *before* the
 * primary-key conflict is noticed — so a second run of the seed, with the same four
 * rows already present, would have the guard raise on the very row it is re-inserting
 * ("appointment overlaps another appointment for this room") and the whole seed would
 * die. The fix is to not attempt the insert at all for rows the clinic already holds;
 * `onConflictDoNothing` stays as the belt for a race between the read and the insert.
 */
async function insertAppointmentsSqlite(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): Promise<void> {
  const existing = await db
    .select({ id: sqliteSchema.appointments.id })
    .from(sqliteSchema.appointments)
    .where(eq(sqliteSchema.appointments.clinicId, DEVELOPMENT_CLINIC_ID));
  const existingIds = new Set(existing.map((row) => row.id));
  const rows = APPOINTMENTS.filter((row) => !existingIds.has(row.id));

  if (rows.length === 0) {
    return;
  }

  await db
    .insert(sqliteSchema.appointments)
    .values([...rows])
    .onConflictDoNothing();
}

// A catalogue the visit workspace and the plan link to. Four rows in fixed order, so
// the treatment picker has something to draw and the plan's items can name a row.
async function insertTreatmentsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.treatments)
    .values([
      {
        id: '11111111-aaaa-4999-8ccc-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'COMPO-ANTERIOR',
        name: 'Composite restoration — anterior',
        description: 'Tooth-coloured filling for incisors and canines.',
        defaultDurationMinutes: 45,
        defaultPriceMinor: 12000,
      },
      {
        id: '11111111-aaaa-4999-8ccc-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'COMPO-POSTERIOR',
        name: 'Composite restoration — posterior',
        description: 'Tooth-coloured filling for premolars and molars.',
        defaultDurationMinutes: 60,
        defaultPriceMinor: 15000,
      },
      {
        id: '11111111-aaaa-4999-8ccc-000000000003',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'RCT',
        name: 'Root canal therapy',
        description: null,
        defaultDurationMinutes: 75,
        defaultPriceMinor: 60000,
      },
      {
        id: '11111111-aaaa-4999-8ccc-000000000004',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'PROPHY',
        name: 'Scaling and prophylaxis',
        description: 'Professional cleaning, scaling and polish.',
        defaultDurationMinutes: 30,
        defaultPriceMinor: 4500,
      },
    ])
    .onConflictDoNothing();
}

async function insertTreatmentsSqlite(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): Promise<void> {
  await db
    .insert(sqliteSchema.treatments)
    .values([
      {
        id: '11111111-aaaa-4999-8ccc-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'COMPO-ANTERIOR',
        name: 'Composite restoration — anterior',
        description: 'Tooth-coloured filling for incisors and canines.',
        defaultDurationMinutes: 45,
        defaultPriceMinor: 12000,
      },
      {
        id: '11111111-aaaa-4999-8ccc-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'COMPO-POSTERIOR',
        name: 'Composite restoration — posterior',
        description: 'Tooth-coloured filling for premolars and molars.',
        defaultDurationMinutes: 60,
        defaultPriceMinor: 15000,
      },
      {
        id: '11111111-aaaa-4999-8ccc-000000000003',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'RCT',
        name: 'Root canal therapy',
        description: null,
        defaultDurationMinutes: 75,
        defaultPriceMinor: 60000,
      },
      {
        id: '11111111-aaaa-4999-8ccc-000000000004',
        clinicId: DEVELOPMENT_CLINIC_ID,
        code: 'PROPHY',
        name: 'Scaling and prophylaxis',
        description: 'Professional cleaning, scaling and polish.',
        defaultDurationMinutes: 30,
        defaultPriceMinor: 4500,
      },
    ])
    .onConflictDoNothing();
}

// Two visits give the profiles real clinical history to render, split across two
// patients so the read side has to prove it filters by patient and not just by
// clinic. Ana (a walk-in) carries a completed composite restoration of tooth 16;
// Luis carries an open booking visit, still in its appointment's chair, with a
// hygiene execution filed and a clinical note beside it — the picture the
// workspace opens to: an OPEN visit with its Treatments and Notes sections
// already populated.
const DAY = 24 * 60 * 60 * 1000;

// Eight more visits on past clinic days, so the directory and each patient's
// history have a page to read. They carry no appointment: a visit is a clinical
// record whether or not a booking produced it, and linking these to slots that
// already happened would make the timeline claim a booking nobody made. One is
// cancelled, because a directory that only ever draws one status is a directory
// that has not been looked at.
const EXTRA_VISITS = [
  {
    id: '11111111-7777-4888-8999-000000000003',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000001',
    dentistId: '11111111-2222-4333-8444-000000000001',
    status: 'COMPLETED',
    startedAt: at(-2, 9, 0),
    endedAt: at(-2, 9, 40),
    reason: 'Routine check-up',
    summary: 'No new findings; hygiene reinforced.',
  },
  {
    id: '11111111-7777-4888-8999-000000000004',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000004',
    dentistId: '11111111-2222-4333-8444-000000000002',
    status: 'COMPLETED',
    startedAt: at(-4, 10, 0),
    endedAt: at(-4, 10, 50),
    reason: 'Pain on the lower left molar',
    summary: 'Caries excavated and a temporary filling placed.',
  },
  {
    id: '11111111-7777-4888-8999-000000000005',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000005',
    dentistId: '11111111-2222-4333-8444-000000000001',
    status: 'COMPLETED',
    startedAt: at(-6, 11, 0),
    endedAt: at(-6, 11, 45),
    reason: 'Broken incisor',
    summary: 'Edge restored with composite; occlusion checked.',
  },
  {
    id: '11111111-7777-4888-8999-000000000006',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000006',
    dentistId: '11111111-2222-4333-8444-000000000002',
    status: 'COMPLETED',
    startedAt: at(-8, 9, 30),
    endedAt: at(-8, 10, 30),
    reason: 'Sensitivity in the upper right quadrant',
    summary: 'Crown seated on tooth 14; margins verified.',
  },
  {
    id: '11111111-7777-4888-8999-000000000007',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000007',
    dentistId: '11111111-2222-4333-8444-000000000001',
    status: 'COMPLETED',
    startedAt: at(-11, 14, 0),
    endedAt: at(-11, 14, 45),
    reason: 'Swelling around the lower right molar',
    summary: 'Root canal started; temporary dressing placed.',
  },
  {
    id: '11111111-7777-4888-8999-000000000008',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000008',
    dentistId: '11111111-2222-4333-8444-000000000002',
    status: 'COMPLETED',
    startedAt: at(-14, 10, 0),
    endedAt: at(-14, 10, 30),
    reason: 'Missing tooth review',
    summary: 'Implant site healing well; no intervention needed.',
  },
  {
    id: '11111111-7777-4888-8999-000000000009',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000009',
    dentistId: '11111111-2222-4333-8444-000000000001',
    status: 'COMPLETED',
    startedAt: at(-18, 9, 0),
    endedAt: at(-18, 9, 50),
    reason: 'Cleaning and sealant review',
    summary: 'Prophylaxis completed; sealants intact.',
  },
  {
    id: '11111111-7777-4888-8999-00000000000a',
    clinicId: DEVELOPMENT_CLINIC_ID,
    patientId: '11111111-3333-4444-8555-000000000003',
    dentistId: '11111111-2222-4333-8444-000000000002',
    status: 'CANCELLED',
    startedAt: at(-9, 15, 0),
    endedAt: null,
    reason: 'Consultation requested by phone',
    summary: null,
  },
] as const;

// Eight findings across the seeded charts; with Luis's two below, ten entries in
// total. Every tooth is permanent FDI and every surface belongs to the tooth's
// site rule, so the map and the detail list both have something true to draw.
const EXTRA_ODONTOGRAM_ENTRIES = [
  {
    id: '11111111-cccc-4ddd-8eee-000000000009',
    patientId: '11111111-3333-4444-8555-000000000001',
    dentition: 'PERMANENT',
    tooth: '26',
    surfaces: ['MESIAL', 'OCCLUSAL'],
    condition: 'CARIES',
    notes: 'Watch at the next check-up.',
    recordedAt: at(-2, 9, 20),
  },
  {
    id: '11111111-cccc-4ddd-8eee-00000000000a',
    patientId: '11111111-3333-4444-8555-000000000003',
    dentition: 'PERMANENT',
    tooth: '46',
    surfaces: ['OCCLUSAL'],
    condition: 'FILLED',
    notes: 'Amalgam replaced with composite in 2023.',
    recordedAt: at(-18, 9, 10),
  },
  {
    id: '11111111-cccc-4ddd-8eee-00000000000b',
    patientId: '11111111-3333-4444-8555-000000000004',
    dentition: 'PERMANENT',
    tooth: '11',
    surfaces: ['INCISAL'],
    condition: 'FRACTURE',
    notes: 'Edge chipped; composite planned.',
    recordedAt: at(-4, 10, 20),
  },
  {
    id: '11111111-cccc-4ddd-8eee-00000000000c',
    patientId: '11111111-3333-4444-8555-000000000005',
    dentition: 'PERMANENT',
    tooth: '36',
    surfaces: [],
    condition: 'ROOT_CANAL',
    notes: 'Completed two-session endodontic treatment.',
    recordedAt: at(-6, 11, 20),
  },
  {
    id: '11111111-cccc-4ddd-8eee-00000000000d',
    patientId: '11111111-3333-4444-8555-000000000006',
    dentition: 'PERMANENT',
    tooth: '47',
    surfaces: [],
    condition: 'MISSING',
    notes: 'Extracted before the patient joined the clinic.',
    recordedAt: at(-8, 10, 10),
  },
  {
    id: '11111111-cccc-4ddd-8eee-00000000000e',
    patientId: '11111111-3333-4444-8555-000000000007',
    dentition: 'PERMANENT',
    tooth: '14',
    surfaces: [],
    condition: 'CROWN',
    notes: 'Ceramic crown seated, margins sound.',
    recordedAt: at(-11, 14, 20),
  },
  {
    id: '11111111-cccc-4ddd-8eee-00000000000f',
    patientId: '11111111-3333-4444-8555-000000000008',
    dentition: 'PERMANENT',
    tooth: '37',
    surfaces: ['OCCLUSAL'],
    condition: 'SEALANT',
    notes: 'Sealant intact at recall.',
    recordedAt: at(-14, 10, 20),
  },
  {
    id: '11111111-cccc-4ddd-8eee-000000000010',
    patientId: '11111111-3333-4444-8555-000000000009',
    dentition: 'PERMANENT',
    tooth: '24',
    surfaces: [],
    condition: 'IMPLANT',
    notes: 'Implant restored with a single crown.',
    recordedAt: at(-18, 9, 20),
  },
] as const;

async function insertVisitsAndPlansPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.visits)
    .values([
      {
        id: '11111111-7777-4888-8999-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        status: 'COMPLETED',
        startedAt: new Date(now.getTime() - 21 * DAY),
        endedAt: new Date(now.getTime() - 21 * DAY + 45 * 60 * 1000),
        reason: 'Sensitivity in the upper right quadrant',
        summary: 'Composite restoration on tooth 16. No complications.',
      },
      {
        id: '11111111-7777-4888-8999-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        dentistId: '11111111-2222-4333-8444-000000000001',
        chairId: '11111111-4444-4555-8666-000000000002',
        // Today's 10:00 appointment, born from it exactly as the start-visit
        // bridge would (ADR 0021); the appointment itself is moved to
        // IN_TREATMENT below, the state the bridge leaves it in.
        appointmentId: '11111111-4444-4555-8666-000000000002',
        status: 'OPEN',
        startedAt: at(0, 10, 0),
        reason: 'Scaling and hygiene visit',
      },
      ...EXTRA_VISITS,
    ])
    .onConflictDoNothing();

  // The bridge's other half (ADR 0021): the appointment is not both SCHEDULED
  // and being treated. An UPDATE is naturally idempotent — re-running the seed
  // re-asserts the same status.
  await db
    .update(pgSchema.appointments)
    .set({ status: 'IN_TREATMENT' })
    .where(eq(pgSchema.appointments.id, '11111111-4444-4555-8666-000000000002'));

  await db
    .insert(pgSchema.treatmentPlans)
    .values({
      id: '11111111-8888-4999-8aaa-000000000001',
      clinicId: DEVELOPMENT_CLINIC_ID,
      patientId: '11111111-3333-4444-8555-000000000001',
      dentistId: '11111111-2222-4333-8444-000000000001',
      status: 'ACCEPTED',
      title: 'Restorative plan',
      presentedAt: new Date(now.getTime() - 20 * DAY),
      acceptedAt: new Date(now.getTime() - 19 * DAY),
    })
    .onConflictDoNothing();

  await db
    .insert(pgSchema.treatmentPlanItems)
    .values([
      {
        id: '11111111-9999-4aaa-8bbb-000000000001',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
        tooth: '26',
        surfaces: ['MESIAL', 'OCCLUSAL'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
      {
        id: '11111111-9999-4aaa-8bbb-000000000002',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
        tooth: '36',
        surfaces: ['OCCLUSAL'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(pgSchema.visitTreatmentExecutions)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000001',
      visitId: '11111111-7777-4888-8999-000000000001',
      treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
      tooth: '16',
      notes: 'No complications.',
      performedAt: new Date(now.getTime() - 21 * DAY + 20 * 60 * 1000),
    })
    .onConflictDoNothing();

  await db
    .insert(pgSchema.visitTreatmentExecutions)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000002',
      visitId: '11111111-7777-4888-8999-000000000002',
      treatmentId: '11111111-aaaa-4999-8ccc-000000000004',
      notes: 'Dental hygiene instructions given.',
      performedAt: at(0, 10, 25),
    })
    .onConflictDoNothing();

  await db
    .insert(pgSchema.clinicalNotes)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000003',
      visitId: '11111111-7777-4888-8999-000000000002',
      body: 'Scaling well tolerated; no discomfort reported after the visit.',
    })
    .onConflictDoNothing();

  await db
    .insert(pgSchema.prescriptions)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000004',
      visitId: '11111111-7777-4888-8999-000000000002',
      patientId: '11111111-3333-4444-8555-000000000002',
      dentistId: '11111111-2222-4333-8444-000000000001',
      issuedAt: at(0, 10, 30),
      medication: 'Ibuprofen',
      dosage: '400 mg',
      route: 'ORAL',
      frequency: 'Every 8 hours if needed',
      durationDays: 5,
      instructions: 'Take after meals. Do not exceed three doses a day.',
    })
    .onConflictDoNothing();

  await db
    .insert(pgSchema.visitAttachments)
    .values([
      {
        id: '11111111-cccc-4ddd-8eee-000000000005',
        visitId: '11111111-7777-4888-8999-000000000002',
        fileName: 'periapical-26-left.png',
        contentType: 'image/png',
        sizeBytes: 512_400,
      },
      {
        id: '11111111-cccc-4ddd-8eee-000000000006',
        visitId: '11111111-7777-4888-8999-000000000002',
        fileName: 'referral-orthodontics.pdf',
        contentType: 'application/pdf',
        sizeBytes: 81_240,
      },
    ])
    .onConflictDoNothing();

  // Luis's chart, so the odontogram opens to a tally rather than an empty map: a
  // site finding on 16 and a whole-tooth one on 36, both recorded ten minutes into
  // his open visit. One page of data beats one row of theory.
  await db
    .insert(pgSchema.odontogramEntries)
    .values([
      {
        id: '11111111-cccc-4ddd-8eee-000000000007',
        patientId: '11111111-3333-4444-8555-000000000002',
        dentition: 'PERMANENT',
        tooth: '16',
        surfaces: ['MESIAL'],
        condition: 'CARIES',
        notes: 'Composite patch scheduled; checked at the last visit.',
        recordedAt: at(0, 10, 20),
      },
      {
        id: '11111111-cccc-4ddd-8eee-000000000008',
        patientId: '11111111-3333-4444-8555-000000000002',
        dentition: 'PERMANENT',
        tooth: '36',
        surfaces: [],
        condition: 'CROWN',
        notes: null,
        recordedAt: at(0, 10, 20),
      },
      ...EXTRA_ODONTOGRAM_ENTRIES.map((entry) => ({ ...entry, surfaces: [...entry.surfaces] })),
    ])
    .onConflictDoNothing();
}

async function insertVisitsAndPlansSqlite(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): Promise<void> {
  await db
    .insert(sqliteSchema.visits)
    .values([
      {
        id: '11111111-7777-4888-8999-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        status: 'COMPLETED',
        startedAt: new Date(now.getTime() - 21 * DAY),
        endedAt: new Date(now.getTime() - 21 * DAY + 45 * 60 * 1000),
        reason: 'Sensitivity in the upper right quadrant',
        summary: 'Composite restoration on tooth 16. No complications.',
      },
      {
        id: '11111111-7777-4888-8999-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        dentistId: '11111111-2222-4333-8444-000000000001',
        chairId: '11111111-4444-4555-8666-000000000002',
        appointmentId: '11111111-4444-4555-8666-000000000002',
        status: 'OPEN',
        startedAt: at(0, 10, 0),
        reason: 'Scaling and hygiene visit',
      },
      ...EXTRA_VISITS,
    ])
    .onConflictDoNothing();

  await db
    .update(sqliteSchema.appointments)
    .set({ status: 'IN_TREATMENT' })
    .where(eq(sqliteSchema.appointments.id, '11111111-4444-4555-8666-000000000002'));

  await db
    .insert(sqliteSchema.treatmentPlans)
    .values({
      id: '11111111-8888-4999-8aaa-000000000001',
      clinicId: DEVELOPMENT_CLINIC_ID,
      patientId: '11111111-3333-4444-8555-000000000001',
      dentistId: '11111111-2222-4333-8444-000000000001',
      status: 'ACCEPTED',
      title: 'Restorative plan',
      presentedAt: new Date(now.getTime() - 20 * DAY),
      acceptedAt: new Date(now.getTime() - 19 * DAY),
    })
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.treatmentPlanItems)
    .values([
      {
        id: '11111111-9999-4aaa-8bbb-000000000001',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
        tooth: '26',
        surfaces: ['MESIAL', 'OCCLUSAL'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
      {
        id: '11111111-9999-4aaa-8bbb-000000000002',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
        tooth: '36',
        surfaces: ['OCCLUSAL'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.visitTreatmentExecutions)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000001',
      visitId: '11111111-7777-4888-8999-000000000001',
      treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
      tooth: '16',
      notes: 'No complications.',
      performedAt: new Date(now.getTime() - 21 * DAY + 20 * 60 * 1000),
    })
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.visitTreatmentExecutions)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000002',
      visitId: '11111111-7777-4888-8999-000000000002',
      treatmentId: '11111111-aaaa-4999-8ccc-000000000004',
      notes: 'Dental hygiene instructions given.',
      performedAt: at(0, 10, 25),
    })
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.clinicalNotes)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000003',
      visitId: '11111111-7777-4888-8999-000000000002',
      body: 'Scaling well tolerated; no discomfort reported after the visit.',
    })
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.prescriptions)
    .values({
      id: '11111111-cccc-4ddd-8eee-000000000004',
      visitId: '11111111-7777-4888-8999-000000000002',
      patientId: '11111111-3333-4444-8555-000000000002',
      dentistId: '11111111-2222-4333-8444-000000000001',
      issuedAt: at(0, 10, 30),
      medication: 'Ibuprofen',
      dosage: '400 mg',
      route: 'ORAL',
      frequency: 'Every 8 hours if needed',
      durationDays: 5,
      instructions: 'Take after meals. Do not exceed three doses a day.',
    })
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.visitAttachments)
    .values([
      {
        id: '11111111-cccc-4ddd-8eee-000000000005',
        visitId: '11111111-7777-4888-8999-000000000002',
        fileName: 'periapical-26-left.png',
        contentType: 'image/png',
        sizeBytes: 512_400,
      },
      {
        id: '11111111-cccc-4ddd-8eee-000000000006',
        visitId: '11111111-7777-4888-8999-000000000002',
        fileName: 'referral-orthodontics.pdf',
        contentType: 'application/pdf',
        sizeBytes: 81_240,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(sqliteSchema.odontogramEntries)
    .values([
      {
        id: '11111111-cccc-4ddd-8eee-000000000007',
        patientId: '11111111-3333-4444-8555-000000000002',
        dentition: 'PERMANENT',
        tooth: '16',
        surfaces: ['MESIAL'],
        condition: 'CARIES',
        notes: 'Composite patch scheduled; checked at the last visit.',
        recordedAt: at(0, 10, 20),
      },
      {
        id: '11111111-cccc-4ddd-8eee-000000000008',
        patientId: '11111111-3333-4444-8555-000000000002',
        dentition: 'PERMANENT',
        tooth: '36',
        surfaces: [],
        condition: 'CROWN',
        notes: null,
        recordedAt: at(0, 10, 20),
      },
      ...EXTRA_ODONTOGRAM_ENTRIES.map((entry) => ({ ...entry, surfaces: [...entry.surfaces] })),
    ])
    .onConflictDoNothing();
}

async function insertChargesPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.charges)
    .values([
      {
        id: '11111111-5555-4666-8777-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        description: 'Composite restoration, tooth 16',
        quantity: '1',
        unitPriceMinor: 12000,
        currency: currencyCode,
      },
      {
        id: '11111111-5555-4666-8777-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        description: 'Scaling and polishing',
        quantity: '1',
        unitPriceMinor: 4500,
        currency: currencyCode,
      },
      // The charge raised on Luis's open visit, so the workspace's Charges section
      // opens to a bill that is growing rather than an empty page: the visit row's
      // own patient and currency, granularity 1, no discount, not yet invoiced.
      {
        id: '11111111-5555-4666-8777-000000000003',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        visitId: '11111111-7777-4888-8999-000000000002',
        description: 'Scaling and prophylaxis',
        quantity: '1',
        unitPriceMinor: 8500,
        discountMinor: 0,
        currency: currencyCode,
        createdAt: at(0, 10, 35),
      },
    ])
    .onConflictDoNothing();
}

async function insertChargesSqlite(db: BetterSQLite3Database<typeof sqliteSchema>): Promise<void> {
  await db
    .insert(sqliteSchema.charges)
    .values([
      {
        id: '11111111-5555-4666-8777-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        description: 'Composite restoration, tooth 16',
        quantity: '1',
        unitPriceMinor: 12000,
        currency: currencyCode,
      },
      {
        id: '11111111-5555-4666-8777-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        description: 'Scaling and polishing',
        quantity: '1',
        unitPriceMinor: 4500,
        currency: currencyCode,
      },
      // The charge raised on Luis's open visit, so the workspace's Charges section
      // opens to a bill that is growing rather than an empty page: the visit row's
      // own patient and currency, granularity 1, no discount, not yet invoiced.
      {
        id: '11111111-5555-4666-8777-000000000003',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        visitId: '11111111-7777-4888-8999-000000000002',
        description: 'Scaling and prophylaxis',
        quantity: '1',
        unitPriceMinor: 8500,
        discountMinor: 0,
        currency: currencyCode,
        createdAt: at(0, 10, 35),
      },
    ])
    .onConflictDoNothing();
}

async function insertPaymentsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.payments)
    .values([
      {
        id: '11111111-6666-4777-8888-000000000001',
        number: 'PAY-000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        method: 'CARD',
        currency: currencyCode,
        amountMinor: 10000,
        receivedAt: new Date(now.getTime() - 2 * DAY),
      },
      {
        // Landed earlier this month, so monthly revenue has something to report
        // on the first of the month.
        id: '11111111-6666-4777-8888-000000000002',
        number: 'PAY-000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        method: 'CASH',
        currency: currencyCode,
        amountMinor: 8000,
        receivedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    ])
    .onConflictDoNothing();
}

async function insertPaymentsSqlite(db: BetterSQLite3Database<typeof sqliteSchema>): Promise<void> {
  await db
    .insert(sqliteSchema.payments)
    .values([
      {
        id: '11111111-6666-4777-8888-000000000001',
        number: 'PAY-000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        method: 'CARD',
        currency: currencyCode,
        amountMinor: 10000,
        receivedAt: new Date(now.getTime() - 2 * DAY),
      },
      {
        id: '11111111-6666-4777-8888-000000000002',
        number: 'PAY-000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        method: 'CASH',
        currency: currencyCode,
        amountMinor: 8000,
        receivedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    ])
    .onConflictDoNothing();
}
let seedResult: string;

if (isSqliteUrl(databaseUrl)) {
  ensureSqliteDatabaseDirectory(databaseUrl);
  const client = new Database(sqliteDatabasePath(databaseUrl));
  client.pragma('foreign_keys = ON');
  const db = sqliteDrizzle(client, { schema: sqliteSchema, casing: 'snake_case' });
  try {
    await seedSqlite(db);
    seedResult = seedSummary();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
    seedResult = 'FAILED';
  } finally {
    client.close();
  }
} else {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { schema: pgSchema, casing: 'snake_case' });
  try {
    await seedPostgres(db);
    seedResult = seedSummary();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
    seedResult = 'FAILED';
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (seedResult !== undefined) {
  console.log(`Seed complete: ${seedResult}`);
  console.log(`CLINIC_ID=${DEVELOPMENT_CLINIC_ID}`);
  console.log('');
  console.log('Development logins (password is development-only):');
  for (const user of DEVELOPMENT_USERS) {
    console.log(`  ${user.role.padEnd(14)} ${user.email}  /  ${DEVELOPMENT_PASSWORD}`);
  }
}
