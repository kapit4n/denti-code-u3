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
  return `clinic ${DEVELOPMENT_CLINIC_ID}, 3 patients, 2 dentists, 2 rooms, 4 chairs, 4 appointments, 2 visits (1 completed, 1 open), 1 plan (2 items), 4 treatments, 2 treatment executions, 1 clinical note, 1 prescription, 2 attachments, 2 odontogram entries, 3 charges, 2 payments`;
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

  await insertDentistsSqlite(db);
  await insertRoomsAndChairsSqlite(db);
  await insertPatientsSqlite(db);
  await insertAppointmentsSqlite(db);
  await insertTreatmentsSqlite(db);
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
        surfaces: ['MO'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
      {
        id: '11111111-9999-4aaa-8bbb-000000000002',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
        tooth: '36',
        surfaces: ['OC'],
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
        surfaces: ['MO'],
        quantity: 1,
        estimatedPriceMinor: 15000,
      },
      {
        id: '11111111-9999-4aaa-8bbb-000000000002',
        treatmentPlanId: '11111111-8888-4999-8aaa-000000000001',
        treatmentId: '11111111-aaaa-4999-8ccc-000000000002',
        tooth: '36',
        surfaces: ['OC'],
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
}
