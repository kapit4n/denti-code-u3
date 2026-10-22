/**
 * Integration test: the reports endpoint on PostgreSQL.
 *
 * The SQLite smoke proves the route on the engine that always runs. This file is
 * the second half of ADR 0025's promise: the PostgreSQL read store answers the same
 * questions — the status split, production attributed through the visit, clinic-wide
 * collections, outstanding less allocations, and the operating hours used as the
 * occupancy denominator — from a real database.
 *
 * The fixture is deliberately small and ordered so the arithmetic is checkable by
 * eye: two appointments (one completed, one scheduled), 300.00 of production, 120.00
 * collected against a 200.00 invoice, one open 80.00 invoice, and a 09:00–13:00 clinic
 * with no break. The report period is one day in UTC.
 *
 * Run it with `TEST_DATABASE_URL` set (see `docs/progress/STATE.md`); without it the
 * suite is skipped, not failed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { DrizzleDentistRepository } from '../src/infrastructure/persistence/repositories/dentist-repository.js';
import { PostgresReportsReadStore } from '../src/infrastructure/persistence/postgres/reports-store.js';
import { registerReportsRoutes } from '../src/http/routes/reports.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

const clinicId = '9a9a1111-1111-4111-8111-111111111111';
const otherClinicId = '9a9a2222-2222-4222-8222-222222222222';
const dentistId = '9b9b1111-1111-4111-8111-111111111111';
const otherDentistId = '9b9b2222-2222-4222-8222-222222222222';
const patientId = '9c9c1111-1111-4111-8111-111111111111';
const visitId = '9d9d1111-1111-4111-8111-111111111111';
const completedAppointmentId = '9e9e1111-1111-4111-8111-111111111111';
const scheduledAppointmentId = '9e9e2222-2222-4222-8222-222222222222';
const paidInvoiceId = '9f9f1111-1111-4111-8111-111111111111';
const openInvoiceId = '9f9f2222-2222-4222-8222-222222222222';
const paymentId = '9f9f3333-3333-4333-8333-333333333333';

const DAY = '2026-10-22';
const NOW = '2026-10-22T18:00:00.000Z';

describeIntegration('reports endpoint (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 4 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  let app: FastifyInstance;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const named = request.headers['x-clinic-id'];
      (request as FastifyRequest & { clinicId: string }).clinicId =
        typeof named === 'string' ? named : clinicId;
    });

    await registerReportsRoutes(app, {
      reports: new PostgresReportsReadStore(db, 'UTC'),
      dentists: new DrizzleDentistRepository(db),
      clock: { now: () => NOW },
    });

    await cleanup();
    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Reports Route', 'UTC', 'USD'),
        (${otherClinicId}, 'Reports Route Other', 'UTC', 'USD')
    `;
    await sql`
      insert into clinic_operating_hours (clinic_id, day_of_week, opens_at, closes_at)
      values
        (${clinicId}, 0, '09:00', '13:00'),
        (${clinicId}, 1, '09:00', '13:00'),
        (${clinicId}, 2, '09:00', '13:00'),
        (${clinicId}, 3, '09:00', '13:00'),
        (${clinicId}, 4, '09:00', '13:00'),
        (${clinicId}, 5, '09:00', '13:00'),
        (${clinicId}, 6, '09:00', '13:00')
    `;
    await sql`
      insert into dentists (id, clinic_id, full_name, is_active)
      values
        (${dentistId}, ${clinicId}, 'Dr Report', true),
        (${otherDentistId}, ${otherClinicId}, 'Dr Foreign', true)
    `;
    await sql`
      insert into patients (id, clinic_id, first_name, last_name)
      values (${patientId}, ${clinicId}, 'Ana', 'Report')
    `;
    await sql`
      insert into visits (id, clinic_id, patient_id, dentist_id, started_at)
      values (${visitId}, ${clinicId}, ${patientId}, ${dentistId}, '2026-10-22T10:00:00Z')
    `;
    await sql`
      insert into appointments (id, clinic_id, patient_id, dentist_id, starts_at, duration_minutes, status)
      values
        (${completedAppointmentId}, ${clinicId}, ${patientId}, ${dentistId}, '2026-10-22T10:00:00Z', 30, 'COMPLETED'),
        (${scheduledAppointmentId}, ${clinicId}, ${patientId}, ${dentistId}, '2026-10-22T11:00:00Z', 45, 'SCHEDULED')
    `;
    await sql`
      insert into invoices (id, clinic_id, patient_id, status, currency, total_minor, subtotal_minor)
      values
        (${paidInvoiceId}, ${clinicId}, ${patientId}, 'ISSUED', 'USD', 20000, 20000),
        (${openInvoiceId}, ${clinicId}, ${patientId}, 'ISSUED', 'USD', 8000, 8000)
    `;
    await sql`
      insert into charges (clinic_id, patient_id, visit_id, description, quantity, unit_price_minor, discount_minor, currency, created_at)
      values
        (${clinicId}, ${patientId}, ${visitId}, 'Crown', 2, 16000, 2000, 'USD', '2026-10-22T10:30:00Z'),
        (${clinicId}, ${patientId}, null, 'Whitening', 1, 5000, 0, 'USD', '2026-10-22T12:00:00Z')
    `;
    await sql`
      insert into payments (id, clinic_id, patient_id, method, currency, amount_minor, received_at)
      values (${paymentId}, ${clinicId}, ${patientId}, 'CARD', 'USD', 12000, '2026-10-22T13:00:00Z')
    `;
    await sql`
      insert into payment_allocations (payment_id, invoice_id, amount_minor)
      values (${paymentId}, ${paidInvoiceId}, 12000)
    `;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  });

  async function cleanup() {
    const ids = [clinicId, otherClinicId];
    await sql`delete from payment_allocations where invoice_id in (select id from invoices where clinic_id in ${sql(ids)})`;
    await sql`delete from payments where clinic_id in ${sql(ids)}`;
    await sql`delete from charges where clinic_id in ${sql(ids)}`;
    await sql`delete from invoices where clinic_id in ${sql(ids)}`;
    await sql`delete from appointments where clinic_id in ${sql(ids)}`;
    await sql`delete from visits where clinic_id in ${sql(ids)}`;
    await sql`delete from patients where clinic_id in ${sql(ids)}`;
    await sql`delete from dentists where clinic_id in ${sql(ids)}`;
    await sql`delete from clinic_operating_hours where clinic_id in ${sql(ids)}`;
    await sql`delete from clinics where id in ${sql(ids)}`;
  }

  it('assembles the period from appointments, charges, payments and hours', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/summary?from=${DAY}&to=${DAY}`,
      headers: { 'x-clinic-id': clinicId },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.appointments).toMatchObject({
      total: 2,
      completed: 1,
      pending: 1,
      bookedMinutes: 75,
    });
    // 2 × 160.00 − 20.00 (visit) + 50.00 (unassigned) = 350.00.
    expect(body.production.totalMinor).toBe(35_000);
    expect(body.collections.totalMinor).toBe(12_000);
    // 280.00 billed − 120.00 allocated.
    expect(body.outstanding.totalMinor).toBe(16_000);
    // 75 booked minutes of one clinician's 240-minute open day.
    expect(body.occupancy).toMatchObject({
      bookedMinutes: 75,
      capacityMinutes: 240,
      rate: 31,
    });

    expect(body.dentists).toEqual([
      expect.objectContaining({
        dentistId,
        dentistName: 'Dr Report',
        appointments: 2,
        productionMinor: 30_000,
        capacityMinutes: 240,
      }),
      expect.objectContaining({
        dentistId: null,
        dentistName: 'Unassigned',
        productionMinor: 5_000,
      }),
    ]);
  });

  it('scopes the clinician filter and keeps collections clinic-wide', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/summary?from=${DAY}&to=${DAY}&dentistId=${dentistId}`,
      headers: { 'x-clinic-id': clinicId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().production.totalMinor).toBe(30_000);
    expect(response.json().collections.totalMinor).toBe(12_000);
    expect(response.json().dentists).toHaveLength(1);
  });

  it('answers 404 for another clinic’s clinician and 422 for an impossible range', async () => {
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/summary?from=${DAY}&to=${DAY}&dentistId=${otherDentistId}`,
      headers: { 'x-clinic-id': clinicId },
    });
    expect(foreign.statusCode).toBe(404);

    const reversed = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary?from=2026-10-31&to=2026-10-01',
      headers: { 'x-clinic-id': clinicId },
    });
    expect(reversed.statusCode).toBe(422);
  });
});
