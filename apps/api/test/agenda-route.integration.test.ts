/**
 * Integration test: `GET /api/v1/appointments` over HTTP.
 *
 * The repository tests prove the query is right. This proves the *request* is
 * right: that a window arrives, that a clinic is attached to it, and that an
 * unreasonable window is refused instead of turning into a table scan.
 *
 * The real route module is exercised through Fastify's `inject` against a real
 * PostgreSQL. A test that called the repository directly would pass even with the
 * route wiring the query string to the wrong fields, and a 366-day window returning
 * 200 rather than 422 is exactly the kind of thing only the boundary can show.
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
import { registerAppointmentsRoutes } from '../src/http/routes/appointments.js';
import { DrizzleAppointmentRepository } from '../src/infrastructure/persistence/repositories/appointment-repository.js';
import { DrizzleClinicRepository } from '../src/infrastructure/persistence/repositories/clinic-repository.js';
import { DrizzleDentistRepository } from '../src/infrastructure/persistence/repositories/dentist-repository.js';
import { DrizzleChairRepository } from '../src/infrastructure/persistence/repositories/chair-repository.js';
import { uuidGenerator } from '../src/infrastructure/id/uuid-generator.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('GET /api/v1/appointments (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = 'b0b0b0b0-0000-4000-8000-000000000001';
  const otherClinicId = 'b0b0b0b0-0000-4000-8000-000000000002';
  const dentistId = 'b0b0b0b0-0000-4000-8000-000000000003';
  const patientId = 'b0b0b0b0-0000-4000-8000-000000000004';
  const chairId = 'b0b0b0b0-0000-4000-8000-000000000005';

  /** A fixed day, so the expectations do not depend on when the suite runs. */
  const day = '2026-05-04';
  const from = `${day}T00:00:00.000Z`;
  const to = '2026-05-05T00:00:00.000Z';

  let app: FastifyInstance;

  /** The clinic the next request is scoped to, read by the hook. */
  let scopedClinicId = clinicId;

  const getAgenda = (query: string, scope: string = clinicId) => {
    scopedClinicId = scope;
    return app.inject({ method: 'GET', url: `/api/v1/appointments?${query}` });
  };

  /** Two days around the fixture day, plus the distant booking. */
  const clearBookings = () =>
    sql`delete from appointments
          where clinic_id in (${clinicId}, ${otherClinicId})
            and (starts_at >= ${from} or starts_at = ${'2026-06-10T09:00:00.000Z'})`;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    // Stands in for the clinic-scope plugin, which reads the same header.
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { clinicId: string }).clinicId = scopedClinicId;
    });
    await registerAppointmentsRoutes(app, {
      appointments: new DrizzleAppointmentRepository(db),
      // The write routes are registered alongside the read one, so their
      // dependencies have to be here even though this file only reads. They are
      // exercised in `appointment-write-route.integration.test.ts`.
      dentists: new DrizzleDentistRepository(db),
      chairs: new DrizzleChairRepository(db),
      clinics: new DrizzleClinicRepository(db),
      ids: uuidGenerator,
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Agenda Route Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Agenda Route Other', 'UTC', 'USD')
      on conflict (id) do nothing
    `;
    await sql`
      insert into dentists (id, clinic_id, full_name)
      values (${dentistId}, ${clinicId}, 'Dr Route')
      on conflict (id) do nothing
    `;
    await sql`
      insert into chairs (id, clinic_id, name)
      values (${chairId}, ${clinicId}, 'Route Chair')
      on conflict (id) do nothing
    `;
    await sql`
      insert into patients (id, clinic_id, first_name, last_name)
      values (${patientId}, ${clinicId}, 'Rita', 'Route')
      on conflict (id) do nothing
    `;

    await clearBookings();
    await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values
        (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${`${day}T09:00:00.000Z`}, 30, 'SCHEDULED'),
        -- A month away, same clinic: the route must pass on the window it was
        -- given rather than asking for the clinic's whole book.
        (${clinicId}, ${patientId}, ${dentistId}, ${chairId}, ${'2026-06-10T09:00:00.000Z'}, 30, 'SCHEDULED')
    `;
  });

  afterAll(async () => {
    await clearBookings();
    await sql`delete from patients where id = ${patientId}`;
    await sql`delete from chairs where id = ${chairId}`;
    await sql`delete from dentists where id = ${dentistId}`;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('returns the window it answered, alongside the entries', async () => {
    const response = await getAgenda(`from=${from}&to=${to}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ window: { from, to } });
    expect(response.json().items).toHaveLength(1);
  });

  it('scopes the agenda to the requesting clinic', async () => {
    // Asked as the other clinic, the same window is empty. Without the clinic
    // filter this would leak a whole clinic's day to whoever asked.
    const response = await getAgenda(`from=${from}&to=${to}`, otherClinicId);

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });

  it('serialises each entry as the read model promises', async () => {
    const response = await getAgenda(`from=${from}&to=${to}`);
    const [entry] = response.json().items;

    expect(entry).toMatchObject({
      clinicId,
      patientFirstName: 'Rita',
      patientLastName: 'Route',
      dentistFullName: 'Dr Route',
      chairName: 'Route Chair',
      startsAt: `${day}T09:00:00.000Z`,
      endsAt: `${day}T09:30:00.000Z`,
      durationMinutes: 30,
      status: 'SCHEDULED',
    });
  });

  it('filters by dentist', async () => {
    const none = 'b0b0b0b0-0000-4000-8000-0000000000ff';
    const response = await getAgenda(`from=${from}&to=${to}&dentistIds=${none}`);

    expect(response.json().items).toEqual([]);
  });

  describe('the window it will accept', () => {
    it('rejects a missing bound', async () => {
      const response = await getAgenda(`to=${to}`);

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a bound that is not a moment in time', async () => {
      const response = await getAgenda(`from=yesterday&to=${to}`);

      expect(response.statusCode).toBe(422);
    });

    it('rejects a window of more than a year', async () => {
      // The clinic has years of appointments and no reason to load them. Unbounded,
      // this is a table scan wearing a query string.
      const response = await getAgenda(`from=2026-01-01T00:00:00.000Z&to=2027-06-01T00:00:00.000Z`);

      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('366 days');
    });

    it('accepts a window of exactly a year', async () => {
      const response = await getAgenda(`from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z`);

      expect(response.statusCode).toBe(200);
    });
  });
});
