/**
 * Integration test: the dashboard's two appointment-derived readings.
 *
 * The dashboard used to query `appointments` itself, filtering on `starts_at`
 * inside today's window. It now shares the agenda repository, which filters on
 * *overlap*. That is a deliberate change with two consequences this file pins
 * down, because both are invisible in a screenshot of a normal day:
 *
 *  - **Booked minutes are clipped to the window.** An appointment that began at
 *    22:30 and runs to 00:30 belongs on today's agenda — the chair is occupied at
 *    midnight — but only 30 of its 120 minutes are today's work. Charging all 120
 *    would report more booked time than the day has, and the occupancy rate would
 *    exceed 100% on a day that is barely booked.
 *  - **Upcoming visits are not cancelled ones.** The repository returns cancelled
 *    work because the calendar needs to show that a slot is deliberately empty.
 *    "What is coming up" is a different question and has to answer it.
 *
 * Run it with:
 *
 *   pnpm run db:up
 *   pnpm run test:integration
 *
 * It uses `TEST_DATABASE_URL` so it can never touch development data.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { resolveClinicTimeWindow } from '../src/application/clinic-time-window.js';
import { registerDashboardRoutes } from '../src/http/routes/dashboard.js';
import { DrizzleAppointmentRepository } from '../src/infrastructure/persistence/repositories/appointment-repository.js';
import { PostgresDashboardReadStore } from '../src/infrastructure/persistence/postgres/dashboard-store.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('dashboard: appointment-derived readings (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = 'c0c0c0c0-0000-4000-8000-000000000001';
  const dentistId = 'c0c0c0c0-0000-4000-8000-000000000002';
  const patientId = 'c0c0c0c0-0000-4000-8000-000000000003';
  const chairId = 'c0c0c0c0-0000-4000-8000-000000000004';

  /**
   * Today, in UTC, computed the same way the route computes it.
   *
   * Booking times are then derived from the window rather than from "now", so the
   * fixtures mean the same thing whether the suite runs at 09:00 or at 23:30 — a
   * `now() - interval '2 hours'` fixture would silently become yesterday's
   * appointment for anyone running the tests late.
   */
  const window = resolveClinicTimeWindow(new Date(), 'UTC');
  const minutesFrom = (from: Date, minutes: number) =>
    new Date(from.getTime() + minutes * 60_000).toISOString();

  /**
   * Three days out, on purpose.
   *
   * "Upcoming" starts at the current instant, so a fixture built from `now` would
   * be in the past for anyone running the suite in the evening — and a fixture
   * built inside today would change today's counts as the hour of the day moved.
   * Three days ahead is always upcoming and never today, whatever time this runs.
   */
  const inThreeDays = (hour: number) => minutesFrom(window.start, 3 * 24 * 60 + hour * 60);

  let app: FastifyInstance;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { clinicId: string }).clinicId = clinicId;
    });
    await registerDashboardRoutes(app, {
      dashboard: new PostgresDashboardReadStore(db, 'UTC'),
      appointments: new DrizzleAppointmentRepository(db),
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values (${clinicId}, 'Dashboard Book Clinic', 'UTC', 'USD')
      on conflict (id) do nothing
    `;
    await sql`
      insert into dentists (id, clinic_id, full_name)
      values (${dentistId}, ${clinicId}, 'Dr Book')
      on conflict (id) do nothing
    `;
    await sql`
      insert into chairs (id, clinic_id, name)
      values (${chairId}, ${clinicId}, 'Book Chair')
      on conflict (id) do nothing
    `;
    await sql`
      insert into patients (id, clinic_id, first_name, last_name)
      values (${patientId}, ${clinicId}, 'Dee', 'Book')
      on conflict (id) do nothing
    `;

    // Known capacity for today's weekday, so `occupancyRate` can be read back as
    // exact booked minutes: one active dentist open 08:00–16:00 is 480 minutes of
    // capacity, and a rate of 19% can only be 90 minutes of work.
    await sql`
      insert into clinic_operating_hours (clinic_id, day_of_week, opens_at, closes_at)
      values (${clinicId}, ${window.dayOfWeek}, '08:00', '16:00')
      on conflict (clinic_id, day_of_week) do nothing
    `;

    await sql`delete from appointments where clinic_id = ${clinicId}`;

    // 60 minutes of ordinary work inside today.
    await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${minutesFrom(window.start, 9 * 60)}, 60, 'SCHEDULED')
    `;
    // Yesterday evening into today: 22:30 for 120 minutes, so 30 of them land today.
    await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${minutesFrom(window.start, -90)}, 120, 'IN_TREATMENT')
    `;
    // Upcoming work: one booked, one cancelled. Neither is today, so today's counts
    // stay the same whatever hour the suite runs.
    await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values
        (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${inThreeDays(9)}, 45, 'SCHEDULED'),
        (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${inThreeDays(11)}, 45, 'CANCELLED')
    `;

    // Cancelled work: counted in today's tally, but not upcoming, and not capacity.
    await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${minutesFrom(window.start, 14 * 60)}, 90, 'CANCELLED')
    `;
  });

  afterAll(async () => {
    // Known capacity for today's weekday, so `occupancyRate` can be read back as
    // exact booked minutes: one active dentist open 08:00–16:00 is 480 minutes of
    // capacity, and a rate of 19% can only be 90 minutes of work.
    await sql`
      insert into clinic_operating_hours (clinic_id, day_of_week, opens_at, closes_at)
      values (${clinicId}, ${window.dayOfWeek}, '08:00', '16:00')
      on conflict (clinic_id, day_of_week) do nothing
    `;

    await sql`delete from appointments where clinic_id = ${clinicId}`;
    await sql`delete from clinic_operating_hours where clinic_id = ${clinicId}`;
    await sql`delete from patients where id = ${patientId}`;
    await sql`delete from chairs where id = ${chairId}`;
    await sql`delete from dentists where id = ${dentistId}`;
    await sql`delete from clinics where id = ${clinicId}`;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('counts an overnight appointment against both days it touches', async () => {
    const items = await app
      .inject({ method: 'GET', url: '/api/v1/dashboard/today-appointments' })
      .then((injected) => injected.json().items);

    // It is on today's book — the dentist is still working at midnight — which the
    // old `starts_at` filter would have hidden, losing an appointment in progress.
    expect(items).toHaveLength(3);
  });

  it('counts only the minutes that fall inside today as booked time', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard/stats' });

    // 60 minutes of today's own work, plus the 30 minutes of the overnight
    // appointment that land after midnight. The cancelled 90 minutes are released.
    // Counting the overnight appointment whole would report 180 booked minutes and
    // 38% occupancy instead of 90 and 19%.
    const { today, clinic } = response.json();
    expect(today.appointments).toBe(3);
    expect(today.cancelled).toBe(1);
    expect(clinic.occupancyRate).toBe(19);
  });

  it('never reports an occupancy rate above 100% for a partly booked day', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard/stats' });
    const rate = response.json().clinic.occupancyRate;

    // The percentage is 0–100, not a fraction: a rate of `1` here would mean one
    // percent booked, or a fully booked day depending on the reader, which is the
    // kind of ambiguity a metric should not have.
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(100);
  });

  it('does not offer a cancelled appointment as an upcoming visit', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard/upcoming-visits' });
    const { items } = response.json();

    // The repository returns the cancelled booking, and this endpoint must not.
    // A receptionist following this list would otherwise knock on a chair for a
    // patient who called to cancel.
    expect(items.map((item: { status: string }) => item.status)).not.toContain('CANCELLED');
    expect(items).toHaveLength(1);
  });

  it('keeps the patient names the dashboard UI already reads', async () => {
    const response = await app
      .inject({ method: 'GET', url: '/api/v1/dashboard/today-appointments' })
      .then((injected) => injected.json());

    // The agenda returns split first/last names; the dashboard's own contract is
    // `firstName`/`lastName`. Reshaping that would break the UI, so the mapping is
    // part of what these tests pin down.
    expect(response.items[0]).toMatchObject({ firstName: 'Dee', lastName: 'Book' });
  });
});
