/**
 * Integration test: editing a patient.
 *
 * The real route module against a real PostgreSQL, because the properties that
 * matter here are database ones and a test that re-implemented the query would
 * keep passing while the route did the wrong thing:
 *
 *  - an edit cannot change the chart number, the active flag or the record's age;
 *  - an edit cannot reach a patient in another clinic;
 *  - an edit cannot revive an anonymised record;
 *  - an absent optional field clears it, which is the whole reason the endpoint is
 *    a PUT rather than a merge.
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
import { systemClock } from '../src/infrastructure/clock/system-clock.js';
import { uuidGenerator } from '../src/infrastructure/id/uuid-generator.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

/** The columns `storedRow` reads, as PostgreSQL stores them. */
interface StoredPatientRow {
  readonly first_name: string;
  readonly last_name: string;
  readonly preferred_name: string | null;
  readonly identification_number: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly birth_date: string | null;
  readonly record_number: string;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('patients: editing (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 10 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = 'dedede00-1111-4111-8111-111111111111';
  const otherClinicId = 'dedede00-2222-4222-8222-222222222222';

  const patientId = 'dedede00-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherClinicPatientId = 'dedede00-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const anonymisedPatientId = 'dedede00-cccc-4ccc-8ccc-cccccccccccc';

  let scopedClinicId = clinicId;
  let app: FastifyInstance;

  function editPatient(patient: string, body: unknown, scope: string = clinicId) {
    scopedClinicId = scope;
    return app.inject({
      method: 'PUT',
      url: `/api/v1/patients/${patient}`,
      payload: body as object,
    });
  }

  /**
   * The row as stored, so assertions are about persistence and not echoes.
   *
   * Timestamps are normalised to `Date`. Whether the driver hands back a string or
   * a `Date` is not a property of the product, and a test comparing two raw driver
   * values would keep passing while comparing the wrong shape.
   *
   * Throws when the row is missing: every test here edits or inspects a record it
   * just created, so an absent row means the fixture failed, not that the patient
   * vanished. Failing loudly beats `expect(row.x).toBeNull()`, which passes for a
   * row that was never there.
   */
  async function storedRow(patient: string): Promise<StoredPatientRow> {
    const rows = await sql`
      select first_name, last_name, preferred_name, identification_number,
             phone, email, birth_date, record_number, is_active, created_at, updated_at
      from patients where id = ${patient}
    `;
    const row = rows[0] as
      | (Record<string, unknown> & { created_at: string | Date; updated_at: string | Date })
      | undefined;

    if (!row) {
      throw new Error(`no stored row for ${patient}; the fixture did not run`);
    }

    return {
      ...(row as unknown as StoredPatientRow),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest & { clinicId: string }) => {
      request.clinicId = scopedClinicId;
    });
    await registerPatientsRoutes(app, {
      patients: new DrizzlePatientRepository(db),
      ids: uuidGenerator,
      clock: systemClock,
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Edit Test Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Other Edit Clinic', 'UTC', 'USD')
      on conflict (id) do nothing
    `;

    await sql`
      delete from patients
      where clinic_id in (${clinicId}, ${otherClinicId})
    `;

    // A fixed timestamp, not `now()`, so "the edit did not touch created_at" is a
    // claim about two known values rather than two nearly identical ones.
    await sql`
      insert into patients (
        id, clinic_id, record_number, first_name, last_name, preferred_name,
        identification_number, phone, email, birth_date, is_active, created_at, updated_at
      )
      values
        (
          ${patientId}, ${clinicId}, 'P-000500', 'Ana', 'García', 'Ana María',
          'CC-OLD-1', '+57 300 111 1111', 'old@example.test', '1990-04-17', true,
          timestamptz '2024-01-15 09:30:00+00', timestamptz '2024-01-15 09:30:00+00'
        ),
        (
          ${otherClinicPatientId}, ${otherClinicId}, 'P-000900', 'Other', 'Clinic',
          null, null, null, null, null, true,
          timestamptz '2024-01-15 09:30:00+00', timestamptz '2024-01-15 09:30:00+00'
        ),
        (
          ${anonymisedPatientId}, ${clinicId}, 'P-000501', 'Gone', 'Record',
          null, null, null, null, null, true,
          timestamptz '2024-01-15 09:30:00+00', timestamptz '2024-01-15 09:30:00+00'
        )
    `;

    // Anonymised in place: the row stays for traceability but must not be readable
    // or writable as a patient.
    await sql`update patients set anonymized_at = now() where id = ${anonymisedPatientId}`;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('overwrites the editable fields and answers 204', async () => {
    const response = await editPatient(patientId, {
      firstName: 'Ana María',
      lastName: 'García Soto',
      preferredName: 'Ana',
      identificationNumber: 'CC-NEW-2',
      phone: '+57 300 222 2222',
      email: 'new@example.test',
      birthDate: '1990-04-17',
    });

    expect(response.statusCode).toBe(204);
    // No body: an updated record assembled from the request would be a value that
    // was never read back from storage.
    expect(response.body).toBe('');

    const row = await storedRow(patientId);
    expect(row).toMatchObject({
      first_name: 'Ana María',
      last_name: 'García Soto',
      preferred_name: 'Ana',
      identification_number: 'CC-NEW-2',
      phone: '+57 300 222 2222',
      email: 'new@example.test',
    });
  });

  it('clears an optional field the edit left out', async () => {
    // The reason this endpoint is a PUT. A merge would have kept the old email on a
    // record whose email was just corrected away.
    await editPatient(patientId, {
      firstName: 'Ana',
      lastName: 'García',
      phone: '+57 300 333 3333',
    });

    const row = await storedRow(patientId);
    expect(row.email).toBeNull();
    expect(row.preferred_name).toBeNull();
    expect(row.identification_number).toBeNull();
    expect(row.phone).toBe('+57 300 333 3333');
  });

  it('leaves the chart number alone', async () => {
    await editPatient(patientId, { firstName: 'Ana', lastName: 'García' });

    // ADR 0015: the number identifies the chart. An edit that could move it would
    // invalidate every document the front desk has already filed under it.
    const row = await storedRow(patientId);
    expect(row.record_number).toBe('P-000500');
  });

  it('ignores a record number sent by the client', async () => {
    const response = await editPatient(patientId, {
      firstName: 'Ana',
      lastName: 'García',
      recordNumber: 'P-999999',
    });

    expect(response.statusCode).toBe(204);
    const row = await storedRow(patientId);
    expect(row.record_number).toBe('P-000500');
  });

  it('ignores isActive, so an edit cannot deactivate a patient', async () => {
    await editPatient(patientId, {
      firstName: 'Ana',
      lastName: 'García',
      isActive: false,
    });

    // Deactivating is a deliberate, separate action. If a stripped field ever
    // reached the database, opening the form to fix a misspelling would take the
    // patient out of every list in the product.
    const row = await storedRow(patientId);
    expect(row.is_active).toBe(true);
  });

  it('does not change when the record was created', async () => {
    const before = await storedRow(patientId);

    await editPatient(patientId, { firstName: 'Ana', lastName: 'García Soto' });

    const after = await storedRow(patientId);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at).not.toEqual(before.updated_at);
  });

  it('bumps updated_at', async () => {
    const before = await storedRow(patientId);

    await editPatient(patientId, { firstName: 'Ana', lastName: 'García' });

    const after = await storedRow(patientId);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it('does not reach a patient in another clinic', async () => {
    const response = await editPatient(
      otherClinicPatientId,
      { firstName: 'Hijacked', lastName: 'Record' },
      // Scoped to our clinic, addressing theirs.
      clinicId,
    );

    // 404, not 403: a caller must not be able to learn that an id exists in a
    // clinic it cannot reach.
    expect(response.statusCode).toBe(404);

    const row = await storedRow(otherClinicPatientId);
    expect(row.first_name).toBe('Other');
    expect(row.last_name).toBe('Clinic');
  });

  it('does not revive an anonymised record', async () => {
    const response = await editPatient(anonymisedPatientId, {
      firstName: 'Revived',
      lastName: 'Record',
    });

    expect(response.statusCode).toBe(404);
    const row = await storedRow(anonymisedPatientId);
    expect(row.first_name).toBe('Gone');
  });

  it('answers 404 for a patient that does not exist', async () => {
    const response = await editPatient('dedede00-ffff-4fff-8fff-ffffffffffff', {
      firstName: 'Nobody',
      lastName: 'Here',
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a body without the required names', async () => {
    const response = await editPatient(patientId, { phone: '+57 300 444 4444' });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.issues).toHaveLength(2);
  });

  it('rejects a birth date that has not happened yet', async () => {
    const before = await storedRow(patientId);

    const response = await editPatient(patientId, {
      firstName: 'Ana',
      lastName: 'García',
      birthDate: '2999-01-01',
    });

    expect(response.statusCode).toBe(422);
    // Rejected as a domain rule; nothing written.
    const after = await storedRow(patientId);
    expect(after.first_name).toBe(before.first_name);
  });

  it('shows the edit on the profile', async () => {
    await editPatient(patientId, {
      firstName: 'Ana María',
      lastName: 'García Soto',
      email: 'shown@example.test',
    });

    scopedClinicId = clinicId;
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${patientId}`,
    });
    const body = response.json();

    expect(body.firstName).toBe('Ana María');
    expect(body.lastName).toBe('García Soto');
    expect(body.email).toBe('shown@example.test');
    // Unchanged by the edit, and worth asserting here because the profile is
    // assembled from several queries.
    expect(body.recordNumber).toBe('P-000500');
  });
});
