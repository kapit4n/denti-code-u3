/**
 * Integration test: `POST /api/v1/visits` on PostgreSQL, through the real route.
 *
 * `visits.integration.test.ts` exercises the use case against a real database and
 * `start-visit.test.ts` exercises it against a fake. Neither can catch the failure mode
 * this file exists for: **the route deciding something the domain already decided**, or
 * forgetting to pass the clinic along. A route that read `dentistId` from the body
 * instead of the booking would pass both of those suites and would be exactly the
 * defect ADR 0021 was written about.
 *
 * So this goes through `app.inject` and asserts on what a client can observe:
 *
 *  - 201 with the visit *and* its appointment, both as the database now holds them;
 *  - 422 for a body the endpoint refuses to read, and specifically that an attempt to
 *    restate the dentist does not change who the visit is attributed to;
 *  - 404 for a booking this clinic does not hold, in the same shape as one that does
 *    not exist at all (ADR 0014);
 *  - 409 for a booking that already has a visit and for one the domain will not start
 *    a visit from — the same status and the same collapsed error code, because the
 *    envelope collapses every rule refusal to `DOMAIN_RULE_VIOLATION` on purpose;
 *  - the clinic comes from the request scope, so the same request under another clinic
 *    header is a different request, not a cross-tenant write.
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
import { registerVisitsRoutes } from '../src/http/routes/visits.js';
import { DrizzleVisitRepository } from '../src/infrastructure/persistence/repositories/visit-repository.js';
import { DrizzleUnitOfWork } from '../src/infrastructure/persistence/postgres/unit-of-work.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('POST /api/v1/visits (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 6 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = '7a7a1111-1111-4111-8111-111111111111';
  const otherClinicId = '7a7a2222-2222-4222-8222-222222222222';

  const patient = '7b7b1111-1111-4111-8111-111111111111';
  const otherPatient = '7b7b2222-2222-4222-8222-222222222222';
  const dentist = '7c7c1111-1111-4111-8111-111111111111';
  const otherDentist = '7c7c2222-2222-4222-8222-222222222222';
  const chair = '7d7d1111-1111-4111-8111-111111111111';
  const otherChair = '7d7d2222-2222-4222-8222-222222222222';
  const missingId = '7e7e9999-9999-4999-8999-999999999999';

  const day = '2026-04-16';
  const NOW = `${day}T14:30:00.000Z`;

  /** An instant on this test's day, for booking a slot that is not already taken. */
  const at = (hour: number, minute = 0) =>
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

  let app: FastifyInstance;

  /**
   * A booking, inserted straight into the table.
   *
   * Through SQL rather than `POST /appointments` because the booking endpoint is covered
   * by its own suite: this file is about what happens after the booking exists, and a
   * test that also depended on the booking route would fail here for its reasons.
   */
  const book = async (overrides: Record<string, unknown> = {}) => {
    const [row] = await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values (
        ${(overrides.clinicId as string) ?? clinicId},
        ${(overrides.patientId as string) ?? patient},
        ${overrides.dentistId === undefined ? dentist : (overrides.dentistId as string | null)},
        ${overrides.chairId === undefined ? chair : (overrides.chairId as string | null)},
        ${(overrides.startsAt as string) ?? `${day}T14:00:00.000Z`},
        ${(overrides.durationMinutes as number) ?? 45},
        ${(overrides.status as string) ?? 'ARRIVED'}
      )
      returning id
    `;
    return (row as { id: string }).id;
  };

  /**
   * Start a visit over HTTP and answer its id.
   *
   * Going through the endpoint rather than inserting the row is deliberate for the two
   * closing endpoints' tests: a visit inserted by hand would not prove the route can
   * find one the API itself wrote, and the clinic scope on `findById` is exactly what
   * that has to get right.
   */
  let bookings = 0;

  const startAndReturnId = async (clinic = clinicId) => {
    // Each booking gets its own *hour*, because the fixture's 45-minute duration means
    // two bookings an hour apart still overlap. Two bookings for the same clinician at
    // overlapping times are refused by `appointments_dentist_no_overlap` — correct, and
    // not what these tests are about: the first draft of this helper booked a fixed 14:00
    // every time, so any test starting two visits died on the exclusion constraint before
    // reaching the assertion it was written for, and the second attempt spaced them by one
    // *minute* and died the same way.
    bookings += 1;
    const appointmentId = await book({ startsAt: at(4 + bookings, 0) });
    const response = await start({ appointmentId }, clinic);
    expect(response.statusCode).toBe(201);
    return (response.json() as { visit: { id: string } }).visit.id;
  };

  const close = (visitId: string, action: 'complete' | 'reopen', clinic = clinicId) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/${action}`,
      headers: { 'x-clinic-id': clinic },
    });

  /**
   * The row as stored, with the timestamp read as an instant.
   *
   * `postgres` answers a `timestamptz` as `2026-04-16 14:30:00+00`, so the comparison is
   * on `new Date(value).toISOString()` and not on the driver's own formatting — which is
   * not ISO and is not something a test should be quietly depending on.
   */
  const readRow = async (visitId: string) => {
    const [row] = await sql`select status, ended_at from visits where id = ${visitId}`;
    const stored = row as { status: string; ended_at: string | null };
    return {
      status: stored.status,
      endedAt: stored.ended_at === null ? null : new Date(stored.ended_at).toISOString(),
    };
  };

  const readBooking = async (appointmentId: string) => {
    const [row] = await sql`select status from appointments where id = ${appointmentId}`;
    return (row as { status: string }).status;
  };

  const start = (payload: unknown, clinic = clinicId) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      headers: { 'x-clinic-id': clinic },
      payload: payload as object,
    });

  /** The two statements that make the fixture removable, given both links are restrict. */
  const clearFixtures = async () => {
    await sql`update appointments set visit_id = null where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`update visits set appointment_id = null where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`delete from visits where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`delete from appointments where clinic_id in (${clinicId}, ${otherClinicId})`;
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    // The header stands in for the clinic-scope plugin, which reads the same thing: a
    // request may name the clinic it is scoped to, and nothing else. Without this the
    // route's `request.clinicId` would be empty and every write would fail for a
    // reason that has nothing to do with the route.
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const named = request.headers['x-clinic-id'];
      (request as FastifyRequest & { clinicId: string }).clinicId =
        typeof named === 'string' ? named : clinicId;
    });

    await registerVisitsRoutes(app, {
      unitOfWork: new DrizzleUnitOfWork(db),
      // The same handle the transaction builds per-transaction repositories from, and
      // deliberately a *separate* dependency: the two closing endpoints write one row and
      // are handed the repository directly (ADR 0022).
      visits: new DrizzleVisitRepository(db),
      clock: { now: () => NOW },
      // The route asks for an id rather than making one, so a test can hand it a fixed
      // generator — but the shape is the real `uuidGenerator`'s.
      ids: { nextId: () => crypto.randomUUID() },
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Visit Route', 'UTC', 'USD'),
        (${otherClinicId}, 'Visit Route Other', 'UTC', 'USD')
      on conflict (id) do nothing
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
    await clearFixtures();
    await sql`delete from patients where id in (${patient}, ${otherPatient})`;
    await sql`delete from dentists where id in (${dentist}, ${otherDentist})`;
    await sql`delete from chairs where id in (${chair}, ${otherChair})`;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await sql.end({ timeout: 5 });
  });

  beforeEach(clearFixtures);

  it('answers 201 with the visit and the appointment as the database now holds them', async () => {
    const appointmentId = await book();

    const response = await start({ appointmentId });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      visit: {
        id: string;
        clinicId: string;
        dentistId: string;
        appointmentId: string;
        status: string;
        startedAt: string;
      };
      appointment: { id: string; status: string; visitId: string };
    };
    expect(body.visit).toMatchObject({
      clinicId,
      patientId: patient,
      dentistId: dentist,
      chairId: chair,
      appointmentId,
      status: 'OPEN',
      // The clock, not the booked time: the booking was for 14:00 and the clinic is
      // half an hour behind, which is the ordinary case.
      startedAt: NOW,
    });
    // Both, because the agenda is showing the booking while this happens. Answering
    // with the visit alone would leave the new booking status to be re-fetched.
    expect(body.appointment).toMatchObject({
      id: appointmentId,
      status: 'IN_TREATMENT',
      visitId: body.visit.id,
    });

    // And the ids agree with the tables, rather than the route assembling a story from
    // the use case's return value.
    const [visitRow] =
      await sql`select status, appointment_id from visits where id = ${body.visit.id}`;
    const [appointmentRow] =
      await sql`select status, visit_id from appointments where id = ${appointmentId}`;
    expect((visitRow as { status: string }).status).toBe('OPEN');
    expect((visitRow as { appointment_id: string }).appointment_id).toBe(appointmentId);
    expect((appointmentRow as { status: string }).status).toBe('IN_TREATMENT');
    expect((appointmentRow as { visit_id: string }).visit_id).toBe(body.visit.id);
  });

  it('ignores a body trying to restate the dentist, the time and the clinic', async () => {
    const appointmentId = await book();

    const response = await start({
      appointmentId,
      dentistId: otherDentist,
      patientId: otherPatient,
      chairId: otherChair,
      startedAt: '2020-01-01T00:00:00.000Z',
      status: 'CLOSED',
      clinicId: otherClinicId,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { visit: Record<string, string> };
    // Every one of those was stripped by the schema, and the row records the booking's
    // clinician under this clinic — the defect ADR 0021 describes would be a 201 with
    // `otherDentist` here.
    expect(body.visit.dentistId).toBe(dentist);
    expect(body.visit.patientId).toBe(patient);
    expect(body.visit.chairId).toBe(chair);
    expect(body.visit.clinicId).toBe(clinicId);
    expect(body.visit.startedAt).toBe(NOW);
    expect(body.visit.status).toBe('OPEN');

    const [row] =
      await sql`select count(*)::int as total from visits where dentist_id = ${otherDentist}`;
    expect((row as { total: number }).total).toBe(0);
  });

  it('answers 422 for a body it cannot read', async () => {
    const response = await start({ appointmentId: 'not-a-uuid' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('answers 422 for an empty body rather than starting a visit for nothing', async () => {
    const response = await start({});

    expect(response.statusCode).toBe(422);
    const [row] = await sql`select count(*)::int as total from visits`;
    expect((row as { total: number }).total).toBe(0);
  });

  it('answers 404 for a booking that does not exist', async () => {
    const response = await start({ appointmentId: missingId });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('answers 404, identically, for a booking belonging to another clinic', async () => {
    const appointmentId = await book({
      clinicId: otherClinicId,
      patientId: otherPatient,
      dentistId: otherDentist,
      chairId: otherChair,
    });

    const response = await start({ appointmentId });

    // Same code and same shape as the id that is nowhere. Distinguishing them would
    // confirm that the id is real somewhere else (ADR 0014).
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

    const [row] =
      await sql`select count(*)::int as total from visits where clinic_id = ${otherClinicId}`;
    expect((row as { total: number }).total).toBe(0);
  });

  it('answers 409 when the booking already became a visit', async () => {
    const appointmentId = await book();

    expect((await start({ appointmentId })).statusCode).toBe(201);
    const second = await start({ appointmentId });

    // Sequenced, so the domain refuses it: the repository reads `visit_id`, and
    // `startVisitFromAppointment` sees the link before writing anything. The envelope
    // answers `DOMAIN_RULE_VIOLATION` rather than the domain's own `DUPLICATED_RECORD`
    // because it collapses every rule refusal to one code on purpose (see `problem.ts`)
    // — so the status is the part a client acts on, and the collapsed code is the part
    // that must not be mistaken for the 404 above.
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'DOMAIN_RULE_VIOLATION' } });

    const [row] =
      await sql`select count(*)::int as total from visits where appointment_id = ${appointmentId}`;
    expect((row as { total: number }).total).toBe(1);
  });

  it('answers 409 for a booking the domain refuses to start a visit from', async () => {
    const appointmentId = await book({ status: 'COMPLETED' });

    const response = await start({ appointmentId });

    // A completed booking is the same shape of answer as the duplicate above, and for
    // the same reason: both are rule refusals at 409, not a syntax problem at 422.
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'DOMAIN_RULE_VIOLATION' } });

    // Nothing written: the appointment is untouched and no visit exists for it.
    const [row] =
      await sql`select count(*)::int as total from visits where appointment_id = ${appointmentId}`;
    expect((row as { total: number }).total).toBe(0);
  });

  it('completes a visit and answers the end time it wrote', async () => {
    const visitId = await startAndReturnId();

    const response = await close(visitId, 'complete');

    expect(response.statusCode).toBe(200);
    // The clock's instant, not a re-read of "now": the route has one clock and passes it
    // down, so the answer and the row cannot disagree.
    expect(response.json()).toMatchObject({ status: 'COMPLETED', endedAt: NOW });
    expect((await readRow(visitId)).endedAt).toBe(new Date(NOW).toISOString());
  });

  it('re-opens a completed visit and answers without an end time', async () => {
    const visitId = await startAndReturnId();
    await close(visitId, 'complete');

    const response = await close(visitId, 'reopen');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; endedAt?: string };
    expect(body.status).toBe('OPEN');
    expect(body.endedAt).toBeUndefined();
    expect((await readRow(visitId)).endedAt).toBeNull();
  });

  it('leaves the appointment alone, which is the decision and not an oversight', async () => {
    const appointmentId = await book();
    const started = await start({ appointmentId });
    const visitId = (started.json() as { visit: { id: string } }).visit.id;

    const response = await close(visitId, 'complete');

    expect(response.statusCode).toBe(200);
    // ADR 0022, Decision 2: the booking is completed through
    // `POST /api/v1/appointments/:id/status`. Until then it reads IN_TREATMENT, and the
    // dashboard keeps counting this patient as in treatment. Coupling them would need a
    // `COMPLETED → IN_TREATMENT` edge that would appear as a button on every completed
    // appointment in the clinic.
    expect(await readBooking(appointmentId)).toBe('IN_TREATMENT');
  });

  it('answers 409 for a visit that is already closed or already open', async () => {
    const completedVisitId = await startAndReturnId();
    await close(completedVisitId, 'complete');

    const again = await close(completedVisitId, 'complete');
    const openVisitId = await startAndReturnId();
    const reopenedTwice = await close(openVisitId, 'reopen');

    // One code for both, because the envelope collapses every rule refusal to
    // `DOMAIN_RULE_VIOLATION` on purpose (see `problem.ts`). The status is the part a
    // client acts on.
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'DOMAIN_RULE_VIOLATION' } });
    expect(reopenedTwice.statusCode).toBe(409);
  });

  it('answers 404 for a visit id that is nowhere', async () => {
    const response = await close(missingId, 'complete');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('answers 404 for a visit belonging to another clinic', async () => {
    const visitId = await startAndReturnId();

    const response = await close(visitId, 'complete', otherClinicId);

    // The same answer as the id that is nowhere: `findById` cannot tell an absent id
    // from another clinic's and must not (ADR 0014).
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await readRow(visitId)).status).toBe('OPEN');
  });

  it('answers 422 for a path id that is not a uuid, without reaching the database', async () => {
    const response = await close('not-a-uuid', 'complete');

    // A hand-typed id would otherwise arrive as PostgreSQL's `22P02`, which is a 500.
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('takes the clinic from the request scope, not from the booking', async () => {
    const appointmentId = await book();

    // The same booking, asked about under the other clinic's header. Refused — the
    // clinic is the request's, and the row's clinic has to be the one in scope.
    const response = await start({ appointmentId }, otherClinicId);

    expect(response.statusCode).toBe(404);
    const [row] =
      await sql`select count(*)::int as total from visits where clinic_id = ${otherClinicId}`;
    expect((row as { total: number }).total).toBe(0);
  });
});
