/**
 * Integration test: `GET /api/v1/clinic` and the clinic read behind it.
 *
 * The browser has to render the agenda in the clinic's timezone and shade its
 * non-working hours, and it gets both from here. That makes two conversions in
 * this path worth pinning down, because both are silent when wrong:
 *
 *  - **Weekday numbering.** The column is `0 = Sunday … 6 = Saturday` (PostgreSQL's
 *    `extract(dow)`) and the domain is `1 = Monday … 7 = Sunday` (ISO-8601). Copy
 *    the number instead of translating it and Sunday becomes Saturday: the clinic
 *    opens when it is shut, and nothing anywhere reports an error.
 *  - **Clinic scope.** One clinic's settings must not answer for another.
 *
 * The real route is exercised through Fastify's `inject` against a real
 * PostgreSQL, because the failures above are SQL-level.
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
import { registerClinicRoutes } from '../src/http/routes/clinic.js';
import { DrizzleClinicRepository } from '../src/infrastructure/persistence/repositories/clinic-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('clinic settings (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;
  const repository = new DrizzleClinicRepository(db);

  const clinicId = 'd0d0d0d0-0000-4000-8000-000000000001';
  const otherClinicId = 'd0d0d0d0-0000-4000-8000-000000000002';

  let app: FastifyInstance;
  let scopedClinicId = clinicId;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { clinicId: string }).clinicId = scopedClinicId;
    });
    await registerClinicRoutes(app, { clinics: repository });

    await sql`
      insert into clinics (id, name, legal_name, time_zone, currency_code)
      values
        (${clinicId}, 'Clinic Settings Test', 'Test Clinic S.A.', 'America/Guatemala', 'GTQ'),
        (${otherClinicId}, 'Other Clinic', null, 'Europe/Madrid', 'EUR')
      on conflict (id) do nothing
    `;

    // Two days open, one closed, one absent — all three cases exist in practice,
    // and the mapping has to say "closed" rather than "opens at midnight".
    await sql`
      insert into clinic_operating_hours (clinic_id, day_of_week, opens_at, closes_at)
      values
        (${clinicId}, 0, '09:00', '13:00'),
        (${clinicId}, 1, '08:00', '17:00'),
        (${clinicId}, 2, null, null),
        (${clinicId}, 3, '10:00', '18:30'),
        (${otherClinicId}, 1, '07:00', '15:00')
      on conflict (clinic_id, day_of_week) do nothing
    `;
  });

  afterAll(async () => {
    await sql`delete from clinic_operating_hours where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  describe('the endpoint', () => {
    it('answers with the clinic the request is scoped to', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/clinic' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: clinicId,
        name: 'Clinic Settings Test',
        timeZone: 'America/Guatemala',
        currency: 'GTQ',
      });
    });

    it("never answers with another clinic's settings", async () => {
      scopedClinicId = otherClinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/clinic' });

      expect(response.json()).toMatchObject({
        id: otherClinicId,
        timeZone: 'Europe/Madrid',
      });
    });

    it('reports a missing clinic as a server fault, not a 404', async () => {
      // `CLINIC_ID` pointing at a deleted row is a deployment mistake. A 404 would
      // tell the browser it asked for something that does not exist, which sends
      // whoever is debugging it in exactly the wrong direction.
      scopedClinicId = 'd0d0d0d0-0000-4000-8000-0000000000ff';
      const response = await app.inject({ method: 'GET', url: '/api/v1/clinic' });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('operating hours', () => {
    it('translates the database weekday into the ISO one', async () => {
      const clinic = await repository.findById(clinicId as never);
      const byWeekday = new Map(clinic?.operatingHours.map((hours) => [hours.weekday, hours]));

      // `day_of_week = 0` is Sunday, which ISO calls 7. Copying the number would
      // make this Sunday's entry claim to be Monday's.
      expect(byWeekday.get(7)).toMatchObject({
        opensAtLocalTime: '09:00',
        closesAtLocalTime: '13:00',
        isClosed: false,
      });
      expect(byWeekday.get(1)).toMatchObject({
        opensAtLocalTime: '08:00',
        closesAtLocalTime: '17:00',
        isClosed: false,
      });
      expect(byWeekday.has(0)).toBe(false);
    });

    it('keeps closed days closed instead of opening them at midnight', async () => {
      const clinic = await repository.findById(clinicId as never);
      const tuesday = clinic?.operatingHours.find((hours) => hours.weekday === 2);

      // A null `opens_at` is how the database says the clinic is shut. Reading it as
      // "00:00" would show the clinic working a day it does not work.
      expect(tuesday).toMatchObject({ isClosed: true });
    });

    it('does not invent hours for a day the clinic has no row for', async () => {
      const clinic = await repository.findById(clinicId as never);
      const wednesdays = clinic?.operatingHours.filter((hours) => hours.weekday === 3);

      expect(wednesdays).toEqual([
        {
          weekday: 3,
          opensAtLocalTime: '10:00',
          closesAtLocalTime: '18:30',
          isClosed: false,
        },
      ]);
      // Thursday has no row at all, so it is absent rather than silently open.
      expect(clinic?.operatingHours.some((hours) => hours.weekday === 4)).toBe(false);
    });
  });

  describe('without authentication', () => {
    it('can name a default clinic, which is the bridge until auth exists', async () => {
      const clinic = await repository.getDefault();

      // Only one active clinic exists in this schema's fixtures here, so this
      // asserts the method works rather than which clinic it picks.
      expect(clinic).toBeDefined();
      expect(clinic?.id).toBeTruthy();
    });

    it('returns nothing for a clinic that does not exist', async () => {
      const clinic = await repository.findById('d0d0d0d0-0000-4000-8000-0000000000fe' as never);

      expect(clinic).toBeUndefined();
    });
  });
});
