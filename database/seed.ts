/**
 * Development seed data.
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
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  appointments,
  charges,
  clinicOperatingHours,
  clinics,
  dentists,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
  visits,
} from '@denti-code-u3/database/schema';

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

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { casing: 'snake_case' });

try {
  const seedResult = await seedDevelopmentData(db);
  console.log(`Seed complete: ${seedResult}`);
  console.log(`CLINIC_ID=${DEVELOPMENT_CLINIC_ID}`);
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

/**
 * Seeds one clinic with enough related data to exercise the dashboard and the
 * patient profile without hand-crafting a database.
 */
async function seedDevelopmentData(database: ReturnType<typeof drizzle>): Promise<string> {
  const timeZone = process.env.CLINIC_TIMEZONE ?? 'America/Argentina/Buenos_Aires';
  const currencyCode = 'USD';

  await database
    .insert(clinics)
    .values({
      id: DEVELOPMENT_CLINIC_ID,
      name: 'Denti-Code Development Clinic',
      timeZone,
      currencyCode,
      isActive: true,
    })
    .onConflictDoNothing();

  await database
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

  await database
    .insert(dentists)
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

  await database
    .insert(patients)
    .values([
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
      {
        // Retired record: proves the list and profile handle inactive patients
        // instead of assuming every row is current.
        id: '11111111-3333-4444-8555-000000000003',
        clinicId: DEVELOPMENT_CLINIC_ID,
        recordNumber: 'P-000003',
        firstName: 'Sofía',
        lastName: 'Ramírez',
        birthDate: '1979-06-30',
        isActive: false,
      },
    ])
    .onConflictDoNothing();

  // Appointments are placed relative to *now* in the clinic's own day, so the
  // dashboard has rows to report whenever the seed is run. A fixed timestamp
  // would put every appointment in the past within a day.
  const now = new Date();
  /** A wall-clock time on a day relative to today, in the server's local zone. */
  const at = (dayOffset: number, hour: number, minute: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);

  await database
    .insert(appointments)
    .values([
      {
        id: '11111111-4444-4555-8666-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        dentistId: '11111111-2222-4333-8444-000000000001',
        startsAt: at(0, 9, 0),
        durationMinutes: 45,
        status: 'CONFIRMED',
      },
      {
        id: '11111111-4444-4555-8666-000000000002',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        dentistId: '11111111-2222-4333-8444-000000000001',
        startsAt: at(0, 10, 0),
        durationMinutes: 60,
        status: 'SCHEDULED',
      },
      {
        id: '11111111-4444-4555-8666-000000000003',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        dentistId: '11111111-2222-4333-8444-000000000002',
        startsAt: at(0, 11, 30),
        durationMinutes: 30,
        status: 'ARRIVED',
      },
      {
        id: '11111111-4444-4555-8666-000000000004',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000002',
        dentistId: '11111111-2222-4333-8444-000000000001',
        // Three days out, at a normal clinic hour rather than the seed's run time.
        startsAt: at(3, 9, 0),
        durationMinutes: 45,
        status: 'SCHEDULED',
      },
    ])
    .onConflictDoNothing();

  // A completed visit and an accepted plan give the patient profile real clinical
  // history to render. Both belong to Ana only, which is what proves the profile
  // filters by patient and not just by clinic.
  await database
    .insert(visits)
    .values([
      {
        id: '11111111-7777-4888-8999-000000000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        status: 'COMPLETED',
        startedAt: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000),
        endedAt: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
        reason: 'Sensitivity in the upper right quadrant',
        summary: 'Composite restoration on tooth 16. No complications.',
      },
    ])
    .onConflictDoNothing();

  await database
    .insert(treatmentPlans)
    .values({
      id: '11111111-8888-4999-8aaa-000000000001',
      clinicId: DEVELOPMENT_CLINIC_ID,
      patientId: '11111111-3333-4444-8555-000000000001',
      dentistId: '11111111-2222-4333-8444-000000000001',
      status: 'ACCEPTED',
      title: 'Restorative plan',
      presentedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(now.getTime() - 19 * 24 * 60 * 60 * 1000),
    })
    .onConflictDoNothing();

  await database
    .insert(treatmentPlanItems)
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

  await database
    .insert(charges)
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

  // A partial payment, so the profile balance is non-zero and the patient is not
  // simply "paid in full" — the interesting case for a balance query.
  await database
    .insert(payments)
    .values([
      {
        id: '11111111-6666-4777-8888-000000000001',
        number: 'PAY-000001',
        clinicId: DEVELOPMENT_CLINIC_ID,
        patientId: '11111111-3333-4444-8555-000000000001',
        method: 'CARD',
        currency: currencyCode,
        amountMinor: 10000,
        receivedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
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

  return `clinic ${DEVELOPMENT_CLINIC_ID}, 3 patients, 2 dentists, 4 appointments, 1 visit, 1 plan (2 items), 2 charges, 2 payments`;
}
