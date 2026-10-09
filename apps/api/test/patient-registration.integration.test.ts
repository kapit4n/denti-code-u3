/**
 * Integration test: registering a patient.
 *
 * The real route module is exercised through Fastify's `inject` against a real
 * PostgreSQL, because the failure modes that matter here are database ones:
 *
 *  - a record number that collides under concurrent registration;
 *  - a patient written into the wrong clinic;
 *  - a number issued to a clinic that already has one.
 *
 * A test that re-implemented the query would keep passing while the route leaked
 * across clinics, which is exactly the class of bug the read-side tests in
 * `patient-profile-scope.integration.test.ts` were written to catch.
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
import { DrizzlePatientRepository } from '../src/infrastructure/persistence/repositories/patient-repository.js';
import { DrizzleOdontogramEntryRepository } from '../src/infrastructure/persistence/repositories/odontogram-entry-repository.js';
import { DrizzleTreatmentPlanRepository } from '../src/infrastructure/persistence/repositories/treatment-plan-repository.js';
import { systemClock } from '../src/infrastructure/clock/system-clock.js';
import { uuidGenerator } from '../src/infrastructure/id/uuid-generator.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('patients: registration (PostgreSQL)', () => {
  // A pool wide enough to actually run requests concurrently. With `max: 1` every
  // query queues on one connection, so transactions are serialised by the driver
  // and the concurrency test below would pass even with the lock removed — it
  // would be testing the pool, not the repository.
  const sql = postgres(databaseUrl as string, { max: 10 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = '22222222-2222-4222-8222-222222222222';
  const otherClinicId = '33333333-3333-4333-8333-333333333333';
  const concurrencyClinicId = 'aaaaaaaa-1111-4111-8111-111111111111';

  let scopedClinicId = clinicId;
  let app: FastifyInstance;

  function registerPatient(body: unknown, scope: string = clinicId) {
    scopedClinicId = scope;
    return app.inject({ method: 'POST', url: '/api/v1/patients', payload: body as object });
  }

  const validPatient = {
    firstName: 'Ana',
    lastName: 'García',
    preferredName: 'Ana María',
    identificationNumber: 'CC-1-2-3',
    phone: '+57 300 000 0000',
    email: 'ana@example.test',
    birthDate: '1990-04-17',
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest & { clinicId: string }) => {
      request.clinicId = scopedClinicId;
    });
    await registerPatientsRoutes(app, {
      patients: new DrizzlePatientRepository(db),
      odontogramEntries: new DrizzleOdontogramEntryRepository(db),
      treatmentPlans: new DrizzleTreatmentPlanRepository(db),
      ids: uuidGenerator,
      clock: systemClock,
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Registration Test Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Other Registration Clinic', 'UTC', 'USD'),
        (${concurrencyClinicId}, 'Concurrency Test Clinic', 'UTC', 'USD')
      on conflict (id) do nothing
    `;

    // These clinics exist only for this file, and the assertions below name exact
    // record numbers (`P-000001`, `P-000002`), so a rerun must start from empty.
    // Without this, the numbers climb on every run and the tests fail for having
    // been run before — which is the worst possible reason for a test to fail.
    await sql`
      delete from patients
      where clinic_id in (${clinicId}, ${otherClinicId}, ${concurrencyClinicId})
    `;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('stores the patient and returns the assigned record number', async () => {
    const response = await registerPatient(validPatient);
    const body = response.json();

    expect(response.statusCode).toBe(201);
    // `P-000001`: the first patient ever registered in this clinic. The exact
    // number is asserted because a wrong number here is invisible everywhere
    // else — the list view would just show it.
    expect(body.recordNumber).toBe('P-000001');
    expect(body.firstName).toBe('Ana');
    expect(body.lastName).toBe('García');
    expect(body.isActive).toBe(true);
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('writes the patient into the clinic the request was scoped to', async () => {
    const response = await registerPatient({ ...validPatient, firstName: 'Scoped' }, otherClinicId);

    expect(response.statusCode).toBe(201);
    // Each clinic has its own sequence: a second clinic's first patient is also
    // P-000001, and that is not a collision.
    expect(response.json().recordNumber).toBe('P-000001');

    const [row] = await sql`
      select clinic_id from patients where id = ${response.json().id}
    `;
    expect(row?.clinic_id).toBe(otherClinicId);
  });

  it('increments the number for subsequent patients in the same clinic', async () => {
    const second = await registerPatient({ ...validPatient, firstName: 'Second' });
    const third = await registerPatient({ ...validPatient, firstName: 'Third' });

    expect(second.json().recordNumber).toBe('P-000002');
    expect(third.json().recordNumber).toBe('P-000003');
  });

  it('gives concurrent registrations distinct numbers', async () => {
    // The regression this guards: reading the highest issued number and
    // inserting with it is two steps, and without a lock two simultaneous
    // requests both read the same maximum and produce the same number. The
    // unique index then rejects one of them with a 500 in front of a patient
    // who is already at the desk.
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        registerPatient({ ...validPatient, firstName: `Race${index}` }, concurrencyClinicId),
      ),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201]);

    const numbers = responses.map((response) => response.json().recordNumber);
    // Sequential by the lock, and unique without it.
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort()).toEqual([
      'P-000001',
      'P-000002',
      'P-000003',
      'P-000004',
      'P-000005',
    ]);
  });

  it('returns the newly registered patient from the list, with its number', async () => {
    // Read-after-write across two endpoints: if the insert wrote a different
    // number than the one returned, this is where it shows. Searched by the
    // generated number as well as the name, because that is how the front desk
    // finds a patient whose name they have misspelled.
    const created = await registerPatient({
      ...validPatient,
      firstName: 'Listable',
      lastName: 'Zzzuniquesurname',
    });
    const createdBody = created.json();

    scopedClinicId = clinicId;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/patients?q=Zzzuniquesurname',
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(createdBody.id);
    expect(items[0].recordNumber).toBe(createdBody.recordNumber);

    scopedClinicId = clinicId;
    const byNumber = await app.inject({
      method: 'GET',
      url: `/api/v1/patients?q=${createdBody.recordNumber}`,
    });
    expect(byNumber.json().items.map((item: { id: string }) => item.id)).toEqual([createdBody.id]);
  });

  it('does not let a client choose its own clinic or record number', async () => {
    const response = await registerPatient({
      ...validPatient,
      firstName: 'Sneaky',
      clinicId: otherClinicId,
      recordNumber: 'P-999999',
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    // ADR 0014: the clinic comes from the request scope, not the body. A client
    // that could write into another clinic would be a cross-tenant write.
    expect(body.clinicId).toBe(clinicId);
    expect(body.recordNumber).not.toBe('P-999999');
  });

  it('trims names and omits optional fields that were not supplied', async () => {
    const response = await registerPatient({
      firstName: '  Blas  ',
      lastName: '  Otero ',
      birthDate: '1980-01-02',
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.firstName).toBe('Blas');
    expect(body.lastName).toBe('Otero');
    expect(body.preferredName).toBeNull();
    expect(body.email).toBeNull();
  });

  it('rejects an empty string where a value was expected', async () => {
    // The boundary is stricter than the domain: `''` is not a valid email, so it
    // never reaches the use case. The use case still normalises whitespace-only
    // values, which is covered by its unit tests.
    const response = await registerPatient({ ...validPatient, email: '' });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.issues[0].path).toEqual(['email']);
  });

  it('rejects a body that does not match the schema', async () => {
    const response = await registerPatient({ firstName: 'NoLastName' });
    const body = response.json();

    expect(response.statusCode).toBe(422);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.issues).toHaveLength(1);
  });

  it('rejects a name that is empty once trimmed', async () => {
    const before = await countPatients();
    const response = await registerPatient({ firstName: '   ', lastName: 'Otero' });

    expect(response.statusCode).toBe(422);
    // A rejected registration must not leave a row behind.
    expect(await countPatients()).toBe(before);
  });

  it('rejects a birth date that has not happened yet', async () => {
    const before = await countPatients();
    const response = await registerPatient({
      ...validPatient,
      birthDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    });

    expect(response.statusCode).toBe(422);
    expect(await countPatients()).toBe(before);
  });

  it('rejects a birth date that is not a real date', async () => {
    const response = await registerPatient({ ...validPatient, birthDate: '1990-02-30' });

    expect(response.statusCode).toBe(422);
  });

  async function countPatients(): Promise<number> {
    // Scoped to this file's clinics, so a registration cannot be blamed on rows
    // another test file inserted.
    const rows = await sql<{ count: number }[]>`
        select count(*)::int as count
        from patients
        where clinic_id in (${clinicId}, ${otherClinicId}, ${concurrencyClinicId})
      `;
    return rows[0]?.count ?? 0;
  }
});
