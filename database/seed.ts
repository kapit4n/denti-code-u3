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
import { drizzle } from 'drizzle-orm/postgres-js';
import Database from 'better-sqlite3';
import { drizzle as sqliteDrizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { isSqliteUrl, sqliteDatabasePath } from './db-url.js';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@denti-code-u3/database/schema';
import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';

/** Must match `CLINIC_ID` in `.env.example`. */
export const DEVELOPMENT_CLINIC_ID = '11111111-1111-4111-8111-111111111111';

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

function seedSummary(): string {
  return `clinic ${DEVELOPMENT_CLINIC_ID}, 3 patients, 2 dentists, 2 rooms, 4 chairs, 4 appointments, 1 visit, 1 plan (2 items), 2 charges, 2 payments`;
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

  await insertDentistsPg(db);
  await insertRoomsAndChairsPg(db);
  await insertPatientsPg(db);
  await insertAppointmentsPg(db);
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

  await insertDentistsSqlite(db);
  await insertRoomsAndChairsSqlite(db);
  await insertPatientsSqlite(db);
  await insertAppointmentsSqlite(db);
  await insertVisitsAndPlansSqlite(db);
  await insertChargesSqlite(db);
  await insertPaymentsSqlite(db);
}

async function insertDentistsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.dentists)
    .values([
      {
        id: '11111111-2222-4333-8444-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        fullName: 'Dr. Elena Vargas',
        speciality: 'General dentistry',
        isActive: true,
      },
      {
        id: '11111111-2222-4333-8444-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
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
        fullName: 'Dr. Elena Vargas',
        speciality: 'General dentistry',
        isActive: true,
      },
      {
        id: '11111111-2222-4333-8444-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
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

async function insertAppointmentsPg(db: PostgresJsDatabase<typeof pgSchema>): Promise<void> {
  await db
    .insert(pgSchema.appointments)
    .values([
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
    ])
    .onConflictDoNothing();
}

async function insertAppointmentsSqlite(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): Promise<void> {
  await db
    .insert(sqliteSchema.appointments)
    .values([
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
        startsAt: at(3, 9, 0),
        durationMinutes: 45,
        status: 'SCHEDULED',
      },
    ])
    .onConflictDoNothing();
}

// A completed visit and an accepted plan give the patient profile real clinical
// history to render. Both belong to Ana only, which is what proves the profile
// filters by patient and not just by clinic.
const DAY = 24 * 60 * 60 * 1000;

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
    ])
    .onConflictDoNothing();

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
        tooth: '26',
        surfaces: ['MO'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
      {
        id: '11111111-9999-4aaa-8bbb-000000000002',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        tooth: '36',
        surfaces: ['OC'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
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
    ])
    .onConflictDoNothing();

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
        tooth: '26',
        surfaces: ['MO'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
      {
        id: '11111111-9999-4aaa-8bbb-000000000002',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        tooth: '36',
        surfaces: ['OC'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
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
    ])
    .onConflictDoNothing();
}

// A partial payment, so the profile balance is non-zero and the patient is not
// simply "paid in full" — the interesting case for a balance query.
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
}
