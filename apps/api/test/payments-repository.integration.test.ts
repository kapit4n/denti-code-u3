/**
 * Integration test: the clinic payment ledger on PostgreSQL.
 *
 * The SQLite smoke covers the route on the engine that always runs; this file is
 * the other half of ADR 0025's promise for the repository that reads it. It proves
 * the window is half-open, another clinic's rows never appear, the method filter
 * applies to both the page and the total, and the patient name is the joined current
 * name rather than a per-row second request.
 *
 * Run it with `TEST_DATABASE_URL` set; without it the suite is skipped, not failed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { asClinicId, type IsoDateTime } from '@denti-code-u3/types';
import { DrizzlePaymentRepository } from '../src/infrastructure/persistence/repositories/payment-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

const clinicId = '7a7a1111-1111-4111-8111-111111111111';
const otherClinicId = '7a7a2222-2222-4222-8222-222222222222';
const preferredPatientId = '7b7b1111-1111-4111-8111-111111111111';
const patientId = '7b7b2222-2222-4222-8222-222222222222';
const otherPatientId = '7b7b3333-3333-4333-8333-333333333333';

const cardPaymentId = '7c7c1111-1111-4111-8111-111111111111';
const cashPaymentId = '7c7c2222-2222-4222-8222-222222222222';
const latePaymentId = '7c7c3333-3333-4333-8333-333333333333';
const earlyPaymentId = '7c7c4444-4444-4444-8444-444444444444';
const foreignPaymentId = '7c7c5555-5555-4555-8555-555555555555';

describeIntegration('PaymentRepository.listForClinic (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 4 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;
  const repository = new DrizzlePaymentRepository(db);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });
    await cleanup();

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Ledger Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Ledger Other', 'UTC', 'USD')
    `;
    await sql`
      insert into patients (id, clinic_id, first_name, last_name, preferred_name)
      values
        (${preferredPatientId}, ${clinicId}, 'Ana', 'Pérez', 'Anita'),
        (${patientId}, ${clinicId}, 'Luis', 'Fernández', null),
        (${otherPatientId}, ${otherClinicId}, 'Far', 'Away', null)
    `;
    await sql`
      insert into payments (id, clinic_id, patient_id, method, currency, amount_minor, reference, received_at)
      values
        (${cardPaymentId}, ${clinicId}, ${preferredPatientId}, 'CARD', 'USD', 10000, '4242', '2026-10-22T10:00:00Z'),
        (${cashPaymentId}, ${clinicId}, ${patientId}, 'CASH', 'USD', 5000, null, '2026-10-22T12:00:00Z'),
        (${latePaymentId}, ${clinicId}, ${patientId}, 'CARD', 'USD', 99900, null, '2026-10-23T00:00:00Z'),
        (${earlyPaymentId}, ${clinicId}, ${patientId}, 'CASH', 'USD', 99900, null, '2026-10-21T23:59:59Z'),
        (${foreignPaymentId}, ${otherClinicId}, ${otherPatientId}, 'CARD', 'USD', 77700, null, '2026-10-22T11:00:00Z')
    `;
  });

  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  async function cleanup() {
    const ids = [clinicId, otherClinicId];
    await sql`delete from payments where clinic_id in ${sql(ids)}`;
    await sql`delete from patients where clinic_id in ${sql(ids)}`;
    await sql`delete from clinics where id in ${sql(ids)}`;
  }

  const dayQuery = {
    from: '2026-10-22T00:00:00.000Z' as IsoDateTime,
    to: '2026-10-23T00:00:00.000Z' as IsoDateTime,
    offset: 0,
    limit: 20,
  };

  it('scopes the window, joins the current patient name and sums the whole filter', async () => {
    const page = await repository.listForClinic(asClinicId(clinicId), dayQuery);

    expect(page.total).toBe(2);
    expect(page.totalAmountMinor).toBe(15_000);
    expect(page.items.map((payment) => payment.id)).toEqual([cashPaymentId, cardPaymentId]);
    expect(page.items[1]).toMatchObject({
      patientId: preferredPatientId,
      patientName: 'Anita',
      method: 'CARD',
      amountMinor: 10_000,
      reference: '4242',
    });
    expect(page.items[0]?.patientName).toBe('Luis Fernández');
  });

  it('applies the method filter to the page and the period total', async () => {
    const page = await repository.listForClinic(asClinicId(clinicId), {
      ...dayQuery,
      method: 'CARD',
    });

    expect(page.total).toBe(1);
    expect(page.totalAmountMinor).toBe(10_000);
    expect(page.items.map((payment) => payment.id)).toEqual([cardPaymentId]);
  });

  it('keeps the period total when only one page is read', async () => {
    const page = await repository.listForClinic(asClinicId(clinicId), {
      ...dayQuery,
      offset: 1,
      limit: 1,
    });

    expect(page.items.map((payment) => payment.id)).toEqual([cardPaymentId]);
    expect(page.total).toBe(2);
    expect(page.totalAmountMinor).toBe(15_000);
  });

  it('reads nothing from another clinic', async () => {
    const page = await repository.listForClinic(asClinicId(otherClinicId), dayQuery);

    expect(page.total).toBe(1);
    expect(page.totalAmountMinor).toBe(77_700);
    expect(page.items.map((payment) => payment.id)).toEqual([foreignPaymentId]);
  });
});
