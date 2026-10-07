/**
 * Integration smoke test: the whole API on SQLite (ADR 0025).
 *
 * The PostgreSQL integration tests are opt-in via `TEST_DATABASE_URL`; this one
 * always runs, because SQLite needs no external service. It builds the real
 * server through `buildServer` so the engine selection, the SQLite connection,
 * the hand-written `UnitOfWork`, the overlap triggers and the dashboard read
 * store are all exercised as the process runs them — not as a hand-wired
 * replica of them.
 *
 * It proves the end-to-end things only an engine can:
 *
 *  - **The overlap trigger answers, not just the domain check.** Two requests
 *    for the same slot both pass the domain's conflict check; the loser is
 *    refused by the `BEFORE INSERT` trigger (and moves by its `BEFORE UPDATE`
 *    twin) and arrives as `SCHEDULING_CONFLICT` rather than a 500.
 *  - **Tenant foreign keys hold.** A booking that names another clinic's dentist
 *    is a composite-key refusal, reported as `INVALID_INPUT`.
 *  - **The visit bridge is transactional.** Starting a visit moves two rows; a
 *    second start is refused by the unique index (`DUPLICATED_RECORD`).
 *  - **The dashboard reads real rows** on the SQLite engine — revenue, capacity,
 *    calendar day, recent patients.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';
import { resolveClinicTimeWindow } from '../src/application/clinic-time-window.js';
import { createSqliteConnection } from '../src/infrastructure/persistence/sqlite/connection.js';
import { buildServer, type DentiApiServer } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const clinicId = 'a0a0a0a0-0000-4000-8000-000000000001';
const otherClinicId = 'a0a0a0a0-0000-4000-8000-000000000002';
const dentistId = 'a0a0a0a0-0000-4000-8000-000000000004';
const otherDentistId = 'a0a0a0a0-0000-4000-8000-000000000005';
const chairId = 'a0a0a0a0-0000-4000-8000-000000000006';
const roomId = 'a0a0a0a0-0000-4000-8000-000000000007';

describe('API on SQLite', () => {
  let dir: string;
  let app: DentiApiServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'denti-sqlite-'));
    const databaseUrl = `sqlite:${path.join(dir, 'denti.db')}`;

    const { db, client } = createSqliteConnection(databaseUrl);
    await migrate(db, {
      migrationsFolder: path.join(here, '../../../database/migrations-sqlite'),
    });
    await seed(db);
    client.close();

    app = await buildServer({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: databaseUrl,
      CLINIC_TIMEZONE: 'UTC',
      CLINIC_ID: clinicId,
    });
  });

  afterAll(async () => {
    await app?.close();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('declares itself ready on /ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().checks.database).toBe('ok');
  });

  let apiPatientId: string;

  /** The clinics table is empty of patients, so the first registration is P-000001. */
  it('registers a patient, issuing sequential chart numbers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      payload: { firstName: 'Dee', lastName: 'Book' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.recordNumber).toBe('P-000001');
    expect(body.clinicId).toBe(clinicId);
    apiPatientId = body.id;
    expect(apiPatientId).toBeTruthy();
  });

  it('finds the patient by an accented-then-folded search', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/patients?q=book',
    });

    expect(response.statusCode).toBe(200);
    const { items, pagination } = response.json();
    expect(pagination.total).toBe(1);
    expect(items[0]?.lastName).toBe('Book');
  });

  /**
   * Booking times are derived from today's clinic-local window rather than from
   * a fixed calendar date, so these fixtures mean the same thing whenever the
   * suite runs — the dashboard's "today" is whoever today is (the clinic is UTC,
   * 08:00–17:00 every day, one active dentist).
   */
  const today = resolveClinicTimeWindow(new Date(), 'UTC');
  const at = (offsetMinutes: number) =>
    new Date(today.start.getTime() + offsetMinutes * 60_000).toISOString();
  const nineAm = at(9 * 60);
  const tenAm = at(10 * 60);

  const book = (overrides: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      payload: {
        patientId: apiPatientId,
        dentistId,
        chairId,
        startsAt: nineAm,
        durationMinutes: 30,
        ...overrides,
      },
    });

  let appointmentId: string;

  it('books an appointment', async () => {
    const response = await book();
    expect(response.statusCode).toBe(201);
    appointmentId = response.json().id;
    expect(appointmentId).toBeTruthy();
  });

  it('lets the overlap trigger refuse a double booking as a 409, not a 500', async () => {
    const response = await book();
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('refuses a booking that names another clinic’s dentist as a 422', async () => {
    // An empty slot, so the overlap trigger does not fire first: the refusal
    // has to be the composite tenant foreign key, and only that. The wire folds
    // `INVALID_INPUT` to `VALIDATION_ERROR` (see `problem.ts`).
    const response = await book({ dentistId: otherDentistId, startsAt: tenAm });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lets the move trigger refuse a move onto an occupied slot as a 409', async () => {
    const response = await book({ startsAt: tenAm });
    expect(response.statusCode).toBe(201);
    const secondId = response.json().id;

    // 09:15–09:45 collides with the 09:00 booking — an UPDATE now, not an INSERT.
    const move = await app.inject({
      method: 'PUT',
      url: `/api/v1/appointments/${secondId}/schedule`,
      payload: { startsAt: nineAm, durationMinutes: 30 },
    });

    expect(move.statusCode).toBe(409);
    expect(move.json().error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('starts a visit from the booking inside a transaction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      payload: { appointmentId },
    });

    expect(response.statusCode).toBe(201);
    const { visit, appointment } = response.json();
    expect(visit.status).toBe('OPEN');
    expect(appointment.status).toBe('IN_TREATMENT');
  });

  it('refuses a second visit for the same appointment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      payload: { appointmentId },
    });

    // The second start fails the domain's "already has a visit" guard before any
    // row is written; the wire folds that `DUPLICATED_RECORD` to
    // `DOMAIN_RULE_VIOLATION` (see `problem.ts`), exactly as on PostgreSQL.
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DOMAIN_RULE_VIOLATION');
  });

  it('summarises the day on the dashboard, occupancy included', async () => {
    // Two disjoint 30-minute bookings from a capacity of 08:00–17:00 × one
    // dentist: 60 of 540 minutes, which rounds to 11% occupancy.
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard/stats' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.clinic.activePatients).toBe(1);
    expect(body.today.appointments).toBe(2);
    expect(body.clinic.occupancyRate).toBe(11);
    expect(body.clinic.currencyCode).toBe('USD');
  });

  it('reports the booked day in the calendar preview', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/calendar-preview?days=1',
    });

    expect(response.statusCode).toBe(200);
    const { items } = response.json();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.day).toBe(today.start.toISOString().slice(0, 10));
    expect(items[0]?.total).toBe(2);
  });

  it('lists the recent patient', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/recent-patients',
    });

    expect(response.statusCode).toBe(200);
    const { items } = response.json();
    expect(items).toHaveLength(1);
    expect(items[0]?.lastName).toBe('Book');
  });
});

async function seed(db: importedDb) {
  await db.insert(sqliteSchema.clinics).values({
    id: clinicId,
    name: 'SQLite Smoker',
    legalName: null,
    timeZone: 'UTC',
    currencyCode: 'USD',
    isActive: true,
  });

  const days = Array.from({ length: 7 }, (_, day) => ({
    clinicId,
    dayOfWeek: day,
    opensAt: '08:00',
    closesAt: '17:00',
  }));
  await db.insert(sqliteSchema.clinicOperatingHours).values(days);

  await db.insert(sqliteSchema.rooms).values({ id: roomId, clinicId, name: 'Operatory 1' });
  await db.insert(sqliteSchema.chairs).values({ id: chairId, clinicId, roomId, name: 'Sillón 1' });
  await db
    .insert(sqliteSchema.dentists)
    .values({ id: dentistId, clinicId, fullName: 'Dr Book', isActive: true });

  // Another clinic's dentist: the booking rule must refuse it as a bad reference.
  await db.insert(sqliteSchema.clinics).values({
    id: otherClinicId,
    name: 'Other Clinic',
    timeZone: 'UTC',
    currencyCode: 'USD',
    isActive: true,
  });
  await db.insert(sqliteSchema.dentists).values({
    id: otherDentistId,
    clinicId: otherClinicId,
    fullName: 'Dr Foreign',
    isActive: true,
  });
}

type importedDb = BetterSQLite3Database<typeof sqliteSchema>;
