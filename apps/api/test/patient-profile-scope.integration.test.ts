/**
 * Integration test: the patient profile must not leak other patients' data.
 *
 * The profile assembles visits and outstanding treatments from separate tables,
 * and it is easy to scope one of them by clinic only. That is not a cosmetic bug:
 * a clinician opening one patient would see another patient's treatment plan.
 *
 * The real route module is exercised through Fastify's `inject` against a real
 * PostgreSQL, because the failure mode is a missing `where` clause — a test that
 * re-implements the query would keep passing while the route leaked data.
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
import { registerPatientsRoutes } from '../src/http/routes/patients.js';
import { DrizzlePatientWriteRepository } from '../src/infrastructure/persistence/repositories/patient-write-repository.js';
import { systemClock } from '../src/infrastructure/clock/system-clock.js';
import { uuidGenerator } from '../src/infrastructure/id/uuid-generator.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('patients: profile scoping (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 1 });
  // Typed with the schema so the route receives the same handle the server uses;
  // an untyped drizzle instance would not satisfy `DentiDatabase`.
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = '44444444-4444-4444-8444-444444444444';
  const otherClinicId = '55555555-5555-4555-8555-555555555555';
  const patientWithHistory = '66666666-6666-4666-8666-666666666666';
  const patientWithoutHistory = '77777777-7777-4777-8777-777777777777';
  const otherClinicPatient = '88888888-8888-4888-8888-888888888888';
  const planId = '99999999-9999-4999-8999-999999999999';
  const visitId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const chargeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  /**
   * The clinic the next request is scoped to, read by the hook.
   *
   * One app instance is reused rather than rebuilt per call: an instance closed
   * while a request is still in flight answers 503, and a fresh instance per
   * assertion would pay the whole Fastify startup cost five times.
   */
  let scopedClinicId = clinicId;
  let app: FastifyInstance;

  function getProfile(patientId: string, scope: string = clinicId) {
    scopedClinicId = scope;
    return app.inject({ method: 'GET', url: `/api/v1/patients/${patientId}` });
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest & { clinicId: string }) => {
      request.clinicId = scopedClinicId;
    });
    // The real write-side dependencies, not stubs: the same handle the server
    // uses, so the registration path is exercised against real PostgreSQL.
    await registerPatientsRoutes(app, {
      db,
      patientWrites: new DrizzlePatientWriteRepository(db),
      ids: uuidGenerator,
      clock: systemClock,
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Scoping Test Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Other Clinic', 'UTC', 'USD')
      on conflict (id) do nothing
    `;

    await sql`
      insert into patients (id, clinic_id, first_name, last_name, record_number)
      values
        (${patientWithHistory}, ${clinicId}, 'With', 'History', 'P-SCOPE-1'),
        (${patientWithoutHistory}, ${clinicId}, 'Without', 'History', 'P-SCOPE-2'),
        (${otherClinicPatient}, ${otherClinicId}, 'Other', 'Clinic', 'P-SCOPE-3')
      on conflict (id) do nothing
    `;

    await sql`
      insert into visits (id, clinic_id, patient_id, status, started_at, reason)
      values (
        ${visitId},
        ${clinicId},
        ${patientWithHistory},
        'COMPLETED',
      now() - interval '3 days',
      'Private history of one patient'
      )
      on conflict (id) do nothing
    `;

    // An accepted plan with one open item, belonging to the first patient only.
    await sql`
      insert into treatment_plans (id, clinic_id, patient_id, status, title)
      values (${planId}, ${clinicId}, ${patientWithHistory}, 'ACCEPTED', 'Plan of patient one')
      on conflict (id) do nothing
    `;

    await sql`
      insert into treatment_plan_items (id, treatment_plan_id, tooth, quantity, estimated_price_minor)
      values (${itemId}, ${planId}, '26', 1, 15000)
      on conflict (id) do nothing
    `;

    // A second patient's charge, so the balance query has something to keep apart.
    await sql`
      insert into charges (id, clinic_id, patient_id, description, quantity, unit_price_minor, currency)
      values (${chargeId}, ${clinicId}, ${patientWithoutHistory}, 'Charge of patient two', 1, 2500, 'USD')
      on conflict (id) do nothing
    `;
  });

  afterAll(async () => {
    // Children first: `patients.clinic_id` is `on delete restrict`, so removing
    // the clinic before its patients fails the foreign key.
    await sql`delete from treatment_plan_items where id = ${itemId}`;
    await sql`delete from treatment_plans where id = ${planId}`;
    await sql`delete from charges where id = ${chargeId}`;
    await sql`delete from visits where id = ${visitId}`;
    await sql`
      delete from patients
      where id in (${patientWithHistory}, ${patientWithoutHistory}, ${otherClinicPatient})
    `;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('returns the visits of the requested patient', async () => {
    const response = await getProfile(patientWithHistory);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.recentVisits).toHaveLength(1);
    expect(body.recentVisits[0].reason).toBe('Private history of one patient');
  });

  it('returns empty collections, not absent keys, for a patient with no history', async () => {
    // Destructuring `[rows]` off an empty result yields `undefined`, which
    // serialises to a missing key and crashes the client on `.length`.
    const response = await getProfile(patientWithoutHistory);

    const body = response.json();
    expect(body).toHaveProperty('recentVisits');
    expect(body).toHaveProperty('outstandingTreatments');
    expect(body.recentVisits).toEqual([]);
    expect(body.outstandingTreatments).toEqual([]);
  });

  it('does not show one patient the outstanding treatments of another', async () => {
    const withHistory = (await getProfile(patientWithHistory)).json();
    const withoutHistory = (await getProfile(patientWithoutHistory)).json();

    expect(withHistory.outstandingTreatments.map((item: { tooth: string }) => item.tooth)).toEqual([
      '26',
    ]);
    // The regression: this query used to filter by clinic only.
    expect(withoutHistory.outstandingTreatments).toEqual([]);
  });

  it("does not include another patient's charges in the balance", async () => {
    const withHistory = (await getProfile(patientWithHistory)).json();
    const withoutHistory = (await getProfile(patientWithoutHistory)).json();

    expect(withHistory.financialBalance.chargeCount).toBe(0);
    expect(withHistory.financialBalance.outstandingMinor).toBe(0);
    expect(withoutHistory.financialBalance.chargeCount).toBe(1);
    expect(withoutHistory.financialBalance.outstandingMinor).toBe(2500);
  });

  it('does not return a patient belonging to another clinic', async () => {
    // Scoped to the wrong clinic, the patient is not visible at all.
    const response = await getProfile(otherClinicPatient, clinicId);

    expect(response.statusCode).toBe(404);
  });
});
