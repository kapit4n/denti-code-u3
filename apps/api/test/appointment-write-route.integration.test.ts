/**
 * Integration test: booking, moving and closing appointments on PostgreSQL.
 *
 * The domain tests prove the rules. This proves the two things only a real
 * database can:
 *
 *  - **The race.** Two requests for the same slot both pass the domain's conflict
 *    check — each is correct about what it can see — and the loser is refused by the
 *    exclusion constraint, arriving as `SCHEDULING_CONFLICT` and not as a 500. This
 *    is the whole reason the constraints exist, and the only place the guarantee is
 *    actually exercised.
 *  - **Tenant isolation.** A booking cannot name another clinic's patient, dentist
 *    or chair, because `0002_appointment_tenant_foreign_keys` made those composite
 *    foreign keys. The API's clinic scoping cannot enforce this: it is a rule about
 *    which rows may be combined, and the combination happens in a table.
 *
 * Exercised through the real route module, so the wiring is covered too: a
 * repository-only test would pass with a route that forgot to pass the clinic along.
 *
 * Run it with:
 *
 *   pnpm run db:up
 *   pnpm run test:integration
 *
 * It uses `TEST_DATABASE_URL` so it can never touch development data.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { uuidGenerator } from '../src/infrastructure/id/uuid-generator.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

/** Monday 2026-09-28. The clinic is open 08:00–17:00, seven days a week. */
const MONDAY = '2026-09-28';

function at(hour: number, minute = 0): string {
  return `${MONDAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

describeIntegration('appointment writes (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 6 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = 'f1f1f1f1-1111-4111-8111-111111111111';
  const otherClinicId = 'f1f1f1f1-2222-4222-8222-222222222222';

  const patient = 'f2f2f2f2-1111-4111-8111-111111111111';
  const dentist = 'f3f3f3f3-1111-4111-8111-111111111111';
  const chair = 'f4f4f4f4-1111-4111-8111-111111111111';
  const otherPatient = 'f2f2f2f2-2222-4222-8222-222222222222';
  const otherDentist = 'f3f3f3f3-2222-4222-8222-222222222222';
  const otherChair = 'f4f4f4f4-2222-4222-8222-222222222222';

  let app: FastifyInstance;

  const book = (overrides: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      payload: {
        patientId: patient,
        dentistId: dentist,
        chairId: chair,
        startsAt: at(9),
        durationMinutes: 30,
        ...overrides,
      },
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    // The header stands in for the clinic-scope plugin, which reads the same
    // thing: a request may name the clinic it is scoped to, and nothing else.
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const named = request.headers['x-clinic-id'];
      (request as FastifyRequest & { clinicId: string }).clinicId =
        typeof named === 'string' ? named : clinicId;
    });
    await registerAppointmentsRoutes(app, {
      appointments: new DrizzleAppointmentRepository(db),
      clinics: new DrizzleClinicRepository(db),
      ids: uuidGenerator,
    });

    for (const id of [clinicId, otherClinicId]) {
      await sql`
        insert into clinics (id, name, time_zone, currency_code)
        values (${id}, 'Write Test', 'UTC', 'USD')
        on conflict (id) do nothing
      `;
    }
    // Open every day, 08:00–17:00, so a 09:00 booking is never refused for being on
    // a Sunday and a 16:30 one-hour booking is refused for overrunning. The column
    // is `opens_at`/`closes_at` with a null time meaning "closed" — there is no
    // `is_closed` flag to contradict them.
    await sql`
      insert into clinic_operating_hours (clinic_id, day_of_week, opens_at, closes_at)
      select ${clinicId}, day, '08:00', '17:00'
      from generate_series(0, 6) as day
      on conflict (clinic_id, day_of_week) do update
        set opens_at = excluded.opens_at, closes_at = excluded.closes_at
    `;
    await sql`
      insert into patients (id, clinic_id, first_name, last_name)
      values
        (${patient}, ${clinicId}, 'Ana', 'Pérez'),
        (${otherPatient}, ${otherClinicId}, 'Bo', 'Peep')
      on conflict (id) do nothing
    `;
    await sql`
      insert into dentists (id, clinic_id, full_name)
      values
        (${dentist}, ${clinicId}, 'Dr Local'),
        (${otherDentist}, ${otherClinicId}, 'Dr Other')
      on conflict (id) do nothing
    `;
    await sql`
      insert into chairs (id, clinic_id, name)
      values
        (${chair}, ${clinicId}, 'Chair 1'),
        (${otherChair}, ${otherClinicId}, 'Chair 9')
      on conflict (id) do nothing
    `;
  });

  afterAll(async () => {
    await app.close();
    await sql`delete from appointments where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`delete from clinic_operating_hours where clinic_id = ${clinicId}`;
    await sql`delete from patients where id in (${patient}, ${otherPatient})`;
    await sql`delete from dentists where id in (${dentist}, ${otherDentist})`;
    await sql`delete from chairs where id in (${chair}, ${otherChair})`;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`delete from appointments where clinic_id = ${clinicId}`;
  });

  it('books an appointment and answers with the row the agenda will show', async () => {
    const response = await book();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      patientFirstName: 'Ana',
      patientLastName: 'Pérez',
      dentistFullName: 'Dr Local',
      chairName: 'Chair 1',
      status: 'SCHEDULED',
      startsAt: at(9),
      durationMinutes: 30,
    });
    // The end time is computed, never stored, and it is the client's job not to
    // work it out: a grid block of a different length is a bug the caller cannot see.
    expect(response.json().endsAt).toBe(at(9, 30));
  });

  it('refuses a second booking for the same dentist and slot with 409, not 500', async () => {
    expect((await book()).statusCode).toBe(201);

    const second = await book();

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('refuses a booking that overlaps the same chair for a different dentist', async () => {
    const secondPatient = 'f2f2f2f2-3333-4333-8333-333333333333';
    const secondDentist = 'f3f3f3f3-3333-4333-8333-333333333333';
    await sql`insert into patients (id, clinic_id, first_name, last_name)
      values (${secondPatient}, ${clinicId}, 'Second', 'Patient') on conflict (id) do nothing`;
    await sql`insert into dentists (id, clinic_id, full_name)
      values (${secondDentist}, ${clinicId}, 'Dr Second') on conflict (id) do nothing`;

    try {
      expect((await book()).statusCode).toBe(201);

      const second = await book({ patientId: secondPatient, dentistId: secondDentist });

      // The dentist is free; the chair is not. A check that compared dentists only
      // would have let this through.
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('SCHEDULING_CONFLICT');
    } finally {
      await sql`delete from dentists where id = ${secondDentist}`;
      await sql`delete from patients where id = ${secondPatient}`;
    }
  });

  it('lets two appointments touch end to end', async () => {
    expect((await book()).statusCode).toBe(201);

    const next = await book({ startsAt: at(9, 30) });

    expect(next.statusCode).toBe(201);
  });

  it('refuses a booking that starts inside opening hours and runs past closing', async () => {
    const response = await book({ startsAt: at(16, 30), durationMinutes: 60 });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a booking outside opening hours entirely', async () => {
    const response = await book({ startsAt: at(7) });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a booking for a patient in another clinic', async () => {
    // The tenant foreign key. A 422, because the answer is "not yours" and a 500
    // would tell the client the server broke.
    const response = await book({ patientId: otherPatient });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it("refuses a booking into another clinic's chair", async () => {
    const response = await book({ chairId: otherChair });

    expect(response.statusCode).toBe(422);
  });

  it('refuses a body that is not a booking at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      payload: { patientId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('refuses a path that is not an appointment id, rather than 500ing in SQL', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/appointments/not-a-uuid/status',
      payload: { to: 'CONFIRMED' },
    });

    expect(response.statusCode).toBe(422);
  });

  describe('the race the domain cannot see', () => {
    it('refuses exactly one of two bookings that pass the same conflict check', async () => {
      // Both requests are honest: each asks the repository what is in the window,
      // each is told "nothing", and each proceeds. The constraint is the only thing
      // that can see both at once, and this is what its refusal looks like from the
      // outside: one 201 and one 409 with SCHEDULING_CONFLICT.
      const [first, second] = await Promise.all([book(), book()]);
      const statuses = [first.statusCode, second.statusCode].sort();

      expect(statuses).toEqual([201, 409]);
      const refused = first.statusCode === 409 ? first : second;
      expect(refused.json().error.code).toBe('SCHEDULING_CONFLICT');

      const rows = await sql<{ count: number }[]>`
        select count(*)::int as count from appointments where clinic_id = ${clinicId}
      `;
      expect(rows[0]?.count).toBe(1);
    });
  });

  describe('moving an appointment', () => {
    async function bookAt(hour: number, minute = 0) {
      const response = await book({ startsAt: at(hour, minute) });
      expect(response.statusCode).toBe(201);
      return response.json() as { id: string; startsAt: string; endsAt: string; status: string };
    }

    it('moves the time and answers with the moved row', async () => {
      const entry = await bookAt(9);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${entry.id}/schedule`,
        payload: { startsAt: at(11) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: entry.id, startsAt: at(11), endsAt: at(11, 30) });
    });

    it('keeps the chair when only the time moves', async () => {
      const entry = await bookAt(9);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${entry.id}/schedule`,
        payload: { startsAt: at(11) },
      });

      // A front desk that changed the hour must not have cleared the chair.
      expect(response.json().chairId).toBe(chair);
    });

    it('refuses a move onto a taken slot', async () => {
      const first = await bookAt(9);
      expect((await bookAt(11)).id).not.toBe(first.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${first.id}/schedule`,
        payload: { startsAt: at(11) },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('SCHEDULING_CONFLICT');
    });

    it('refuses a move outside opening hours', async () => {
      const entry = await bookAt(9);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${entry.id}/schedule`,
        payload: { startsAt: at(19) },
      });

      expect(response.statusCode).toBe(422);
    });

    it('refuses to move an appointment that has already been attended to', async () => {
      const entry = await bookAt(9);
      await sql`update appointments set status = 'ARRIVED' where id = ${entry.id}`;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${entry.id}/schedule`,
        payload: { startsAt: at(11) },
      });

      // Once the patient is here, the booked time is history. Rewriting it is
      // falsifying the record, not fixing it.
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('DOMAIN_RULE_VIOLATION');
    });

    it('answers 404 for an appointment in another clinic', async () => {
      const entry = await bookAt(9);

      // Same id, another clinic's scope: the answer must be indistinguishable from
      // an id that does not exist, because confirming that an id exists somewhere
      // else is itself a disclosure.
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/appointments/${entry.id}/schedule`,
        headers: { 'x-clinic-id': otherClinicId },
        payload: { startsAt: at(11) },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("changing an appointment's status", () => {
    async function bookAt(hour: number, minute = 0) {
      const response = await book({ startsAt: at(hour, minute) });
      expect(response.statusCode).toBe(201);
      return response.json() as { id: string; status: string };
    }

    const setStatus = (id: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/appointments/${id}/status`,
        payload,
      });

    it('confirms a scheduled appointment', async () => {
      const entry = await bookAt(9);

      const response = await setStatus(entry.id, { to: 'CONFIRMED' });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('CONFIRMED');
    });

    it('refuses a transition the lifecycle does not allow', async () => {
      const entry = await bookAt(9);
      await setStatus(entry.id, { to: 'CONFIRMED' });
      await setStatus(entry.id, { to: 'ARRIVED' });
      await setStatus(entry.id, { to: 'COMPLETED' });

      const response = await setStatus(entry.id, { to: 'SCHEDULED' });

      expect(response.statusCode).toBe(409);
    });

    it('insists on a reason for a cancellation', async () => {
      const entry = await bookAt(9);

      const refused = await setStatus(entry.id, { to: 'CANCELLED' });
      const accepted = await setStatus(entry.id, { to: 'CANCELLED', reason: 'Patient unwell' });

      expect(refused.statusCode).toBe(422);
      expect(accepted.statusCode).toBe(200);
    });

    it('records why an appointment was cancelled', async () => {
      const entry = await bookAt(9);

      await setStatus(entry.id, { to: 'CANCELLED', reason: 'Patient rescheduled by phone' });

      const rows = await sql<{ cancelled_reason: string }[]>`
        select cancelled_reason from appointments where id = ${entry.id}
      `;
      expect(rows[0]?.cancelled_reason).toBe('Patient rescheduled by phone');
    });

    it('frees the slot when an appointment is cancelled', async () => {
      const first = await bookAt(9);
      await setStatus(first.id, { to: 'CANCELLED', reason: 'Patient unwell' });

      // A second booking for the same slot now succeeds, because a cancellation
      // releases the chair.
      const second = await book({ startsAt: at(9) });

      expect(second.statusCode).toBe(201);
    });

    it('refuses to un-cancel into a slot that has since been taken', async () => {
      // The subtle one: the cancelled appointment held nothing, so the moment it
      // takes a chair again it has to win one. Without this check both receptionists
      // press undo and both succeed.
      const first = await bookAt(9);
      await setStatus(first.id, { to: 'CANCELLED', reason: 'Patient unwell' });
      expect((await book({ startsAt: at(9) })).statusCode).toBe(201);

      const response = await setStatus(first.id, { to: 'SCHEDULED' });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('SCHEDULING_CONFLICT');
    });

    it('refuses to un-cancel a slot that is still free, because that is the point', async () => {
      // The same request in the empty-slot case must succeed, or the check above
      // would be passing for the wrong reason.
      const entry = await bookAt(9);
      await setStatus(entry.id, { to: 'CANCELLED', reason: 'Patient unwell' });

      const response = await setStatus(entry.id, { to: 'SCHEDULED' });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('SCHEDULED');
    });

    it('answers 404 for an appointment that does not exist', async () => {
      const response = await setStatus('f9f9f9f9-1111-4111-8111-111111111111', { to: 'CONFIRMED' });

      expect(response.statusCode).toBe(404);
    });
  });
});
