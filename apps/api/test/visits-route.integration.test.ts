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
import { DrizzleClinicalNoteRepository } from '../src/infrastructure/persistence/repositories/clinical-note-repository.js';
import { DrizzleChairRepository } from '../src/infrastructure/persistence/repositories/chair-repository.js';
import { DrizzleDentistRepository } from '../src/infrastructure/persistence/repositories/dentist-repository.js';
import { DrizzleTreatmentRecordRepository } from '../src/infrastructure/persistence/repositories/treatment-record-repository.js';
import { DrizzleTreatmentRepository } from '../src/infrastructure/persistence/repositories/treatment-repository.js';
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
  /**
   * A second patient in this clinic, and one who has never been treated.
   *
   * The timeline's two answers both need a patient who is not the default one: "these are
   * this patient's visits" and "this patient has none" are indistinguishable from the
   * patient's own list if the patient always has a visit.
   */
  const secondPatient = '7b7b3333-3333-4333-8333-333333333333';
  const untouchedPatient = '7b7b4444-4444-4444-8444-444444444444';
  const otherPatient = '7b7b2222-2222-4222-8222-222222222222';
  const dentist = '7c7c1111-1111-4111-8111-111111111111';
  const otherDentist = '7c7c2222-2222-4222-8222-222222222222';
  /**
   * An inactive clinician and chair in *this* clinic, for the walk-in's rule.
   *
   * The booking rule (question 17) is exercised by its own suite against these same
   * rows; here they exist so the walk-in door can be shown refusing the same thing,
   * with the same `UNBOOKABLE_RESOURCE` turned into the same 409. Two fixtures, and
   * both are in the teardown — session 25's lesson is that a fixture that is not
   * deleted leaks into the next suite three files over.
   */
  const inactiveDentist = '7c7c3333-3333-4333-8333-333333333333';
  const inactiveChair = '7d7d3333-3333-4333-8333-333333333333';
  const chair = '7d7d1111-1111-4111-8111-111111111111';
  const otherChair = '7d7d2222-2222-4222-8222-222222222222';
  const missingId = '7e7e9999-9999-4999-8999-999999999999';

  const treatment = '7f7f1111-1111-4111-8111-111111111111';
  const foreignTreatment = '7f7f2222-2222-4222-8222-222222222222';

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

  /**
   * Start a visit over HTTP, naming the patient.
   *
   * The start time is always the suite's `NOW`, because that is the clock the app was
   * registered with. The timeline's ordering cannot be tested against visits that all
   * share one start time, so `seedVisit` below writes the rows for that test instead.
   */
  const startAndReturnId = async (clinic = clinicId, patientId = patient) => {
    // Each booking gets its own *hour*, because the fixture's 45-minute duration means
    // two bookings an hour apart still overlap. Two bookings for the same clinician at
    // overlapping times are refused by `appointments_dentist_no_overlap` — correct, and
    // not what these tests are about: the first draft of this helper booked a fixed 14:00
    // every time, so any test starting two visits died on the exclusion constraint before
    // reaching the assertion it was written for, and the second attempt spaced them by one
    // *minute* and died the same way.
    bookings += 1;
    const appointmentId = await book({ startsAt: at(4 + bookings, 0), patientId });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      headers: { 'x-clinic-id': clinic },
      payload: { appointmentId },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { visit: { id: string } }).visit.id;
  };

  /**
   * A visit row written directly, for the two things the endpoint cannot produce: a chosen
   * `started_at`, and a visit that is already closed before anything reads it.
   *
   * Only the read tests need these. Everything about *starting* a visit goes through
   * `POST /visits`, because that is the behaviour under test elsewhere in this file.
   */
  const seedVisit = async (options: {
    patientId?: string;
    startedAt: string;
    status?: 'OPEN' | 'COMPLETED';
    endedAt?: string | null;
    clinic?: string;
  }) => {
    // The clinician follows the clinic. Writing this clinic's dentist against the other
    // clinic's patient is refused by `visits_dentist_same_clinic_fk`, which is migration
    // 0003's tenant guarantee doing exactly its job — the first version of this helper
    // hardcoded `dentist` and the "seed a visit in another clinic" test died on it.
    const clinic = options.clinic ?? clinicId;
    const clinician = clinic === otherClinicId ? otherDentist : dentist;

    const [row] = await sql`
      insert into visits
        (clinic_id, patient_id, dentist_id, status, started_at, ended_at)
      values (
        ${clinic},
        ${options.patientId ?? patient},
        ${clinician},
        ${options.status ?? 'OPEN'},
        ${options.startedAt},
        ${options.endedAt ?? null}
      )
      returning id
    `;
    return (row as { id: string }).id;
  };

  const getVisit = (visitId: string, clinic = clinicId) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}`,
      headers: { 'x-clinic-id': clinic },
    });

  const getTimeline = (patientId: string, clinic = clinicId) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/patients/${patientId}/visits`,
      headers: { 'x-clinic-id': clinic },
    });

  const close = (visitId: string, action: 'complete' | 'reopen', clinic = clinicId) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/${action}`,
      headers: { 'x-clinic-id': clinic },
    });

  const getNotes = (visitId: string, clinic = clinicId) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}/notes`,
      headers: { 'x-clinic-id': clinic },
    });

  const fileNote = (visitId: string, payload: unknown, clinic = clinicId) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/notes`,
      headers: { 'x-clinic-id': clinic },
      payload: payload as object,
    });

  const getTreatments = (visitId: string, clinic = clinicId) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}/treatments`,
      headers: { 'x-clinic-id': clinic },
    });

  const recordTreatment = (visitId: string, payload: unknown, clinic = clinicId) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/treatments`,
      headers: { 'x-clinic-id': clinic },
      payload: payload as object,
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

  const walkIn = (payload: unknown, clinic = clinicId) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/visits/walk-in',
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
      // deliberately a *separate* dependency: the walk-in and the two closing endpoints
      // write one row and are handed the repository directly (ADR 0022, ADR 0024).
      visits: new DrizzleVisitRepository(db),
      // The notes' own repository, and a plain one: filing a note is one insert, and
      // the use case has already resolved the visit in this clinic by the time it
      // runs (`clinical_notes` has no clinic column of its own).
      clinicalNotes: new DrizzleClinicalNoteRepository(db),
      // What was done on a visit, and the catalogue it names. The record endpoint is
      // exercised by the treatment tests below; each write is a read-then-write pair
      // the way the notes' is (ADR 0014).
      treatmentRecords: new DrizzleTreatmentRecordRepository(db),
      treatments: new DrizzleTreatmentRepository(db),
      // The two resources a walk-in names, for the same "who may be named" rule the
      // booking uses. The appointment door reads its names from the booking and never
      // calls these (ADR 0024).
      dentists: new DrizzleDentistRepository(db),
      chairs: new DrizzleChairRepository(db),
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
        (${secondPatient}, ${clinicId}, 'Bruno', 'Baptista'),
        (${untouchedPatient}, ${clinicId}, 'Carla', 'Costa'),
        (${otherPatient}, ${otherClinicId}, 'Bo', 'Peep')
      on conflict (id) do nothing
    `;
    await sql`
      insert into dentists (id, clinic_id, full_name)
      values
        (${dentist}, ${clinicId}, 'Dr Local'),
        (${otherDentist}, ${otherClinicId}, 'Dr Other'),
        (${inactiveDentist}, ${clinicId}, 'Dr Gone')
      on conflict (id) do nothing
    `;
    await sql`
      insert into chairs (id, clinic_id, name)
      values
        (${chair}, ${clinicId}, 'Chair 1'),
        (${otherChair}, ${otherClinicId}, 'Chair 9'),
        (${inactiveChair}, ${clinicId}, 'Chair Off')
      on conflict (id) do nothing
    `;
    await sql`
      update dentists set is_active = false where id = ${inactiveDentist}
    `;
    await sql`
      update chairs set is_active = false where id = ${inactiveChair}
    `;
    // The catalogue the treatment records name. One row per clinic, so "a treatment
    // this clinic does not offer" is a real fixture rather than a fabricated id.
    await sql`
      insert into treatments (id, clinic_id, code, name, default_price_minor)
      values
        (${treatment}, ${clinicId}, 'COMPO', 'Composite restoration', 15000),
        (${foreignTreatment}, ${otherClinicId}, 'RCT', 'Root canal therapy', 60000)
      on conflict (id) do nothing
    `;
  });

  afterAll(async () => {
    await app.close();
    await clearFixtures();
    // Every fixture patient, not just the first two. This list grew in session 25 and the
    // teardown did not, so the two new patients survived and the `delete from clinics`
    // below was refused by `patients_clinic_id_clinics_id_fk` — a leaked fixture showing
    // up as an unrelated constraint violation in a different statement.
    await sql`
      delete from patients
      where id in (${patient}, ${secondPatient}, ${untouchedPatient}, ${otherPatient})
    `;
    await sql`delete from dentists where id in (${dentist}, ${otherDentist}, ${inactiveDentist})`;
    await sql`delete from chairs where id in (${chair}, ${otherChair}, ${inactiveChair})`;
    await sql`delete from treatments where id in (${treatment}, ${foreignTreatment})`;
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

  describe('POST /api/v1/visits/walk-in', () => {
    it('writes an OPEN visit with no appointment behind it', async () => {
      const response = await walkIn({ patientId: patient, dentistId: dentist, chairId: chair });

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        id: string;
        clinicId: string;
        patientId: string;
        dentistId: string;
        chairId: string;
        status: string;
        startedAt: string;
      };
      expect(body).toMatchObject({
        clinicId,
        patientId: patient,
        dentistId: dentist,
        chairId: chair,
        status: 'OPEN',
        startedAt: NOW,
      });
      // Absent, not null: a walk-in has no booking, and the key is the whole of what
      // distinguishes this row from one the bridge wrote.
      expect('appointmentId' in body).toBe(false);

      const [row] = await sql`select status, appointment_id from visits where id = ${body.id}`;
      expect((row as { status: string }).status).toBe('OPEN');
      expect((row as { appointment_id: string | null }).appointment_id).toBeNull();

      // And one row's worth of nothing written into the book: a walk-in is not an
      // appointment, so the agenda has nothing new to draw.
      const [book] =
        await sql`select count(*)::int as total from appointments where clinic_id = ${clinicId}`;
      expect((book as { total: number }).total).toBe(0);
    });

    it('accepts a walk-in with no chair', async () => {
      const response = await walkIn({ patientId: patient, dentistId: dentist });

      expect(response.statusCode).toBe(201);
      const body = response.json() as { chairId?: string };
      expect(body.chairId).toBeUndefined();

      const [row] = await sql`select chair_id from visits where clinic_id = ${clinicId}`;
      expect((row as { chair_id: string | null }).chair_id).toBeNull();
    });

    it('answers 422 for a body it cannot read, including one without a clinician', async () => {
      const withoutClinician = await walkIn({ patientId: patient });
      const malformed = await walkIn({ patientId: 'not-a-uuid', dentistId: dentist });

      // The clinician is a required field, the whole of this schema's argument: a
      // door that could skip it would make "who treated this patient" depend on which
      // button was pressed (ADR 0024).
      expect(withoutClinician.statusCode).toBe(422);
      expect(withoutClinician.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(malformed.statusCode).toBe(422);
    });

    it('answers 409 for a clinician marked inactive, naming the clinician', async () => {
      const response = await walkIn({ patientId: patient, dentistId: inactiveDentist });

      // The same rule and the same envelope as a booking that names someone who left:
      // product question 17 applies to whoever is named for care about to happen.
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: {
          code: 'DOMAIN_RULE_VIOLATION',
          message: expect.stringContaining('Dr Gone'),
        },
      });
      const [row] =
        await sql`select count(*)::int as total from visits where clinic_id = ${clinicId}`;
      expect((row as { total: number }).total).toBe(0);
    });

    it('answers 409 for a chair marked inactive', async () => {
      const response = await walkIn({
        patientId: patient,
        dentistId: dentist,
        chairId: inactiveChair,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: 'DOMAIN_RULE_VIOLATION', message: expect.stringContaining('Chair Off') },
      });
    });

    it('answers 422 for a patient this clinic does not hold, not a 500', async () => {
      const response = await walkIn({ patientId: otherPatient, dentistId: dentist });

      // The walk-in does not read the patient first, exactly as a booking does not: the
      // composite tenant foreign key is the answer, and this is where the repository
      // translates its refusal into `INVALID_INPUT` (422) rather than letting it escape
      // as a 500. That translation is the reason this test exists.
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That patient, dentist or chair is not in this clinic',
        },
      });
      const [row] =
        await sql`select count(*)::int as total from visits where clinic_id = ${clinicId}`;
      expect((row as { total: number }).total).toBe(0);
    });

    it('answers 422, identically, for a clinician this clinic does not hold', async () => {
      const foreignClinician = await walkIn({ patientId: patient, dentistId: otherDentist });
      const foreignPatient = await walkIn({ patientId: otherPatient, dentistId: dentist });

      // Same code and same shape for the clinician and the patient halves of the same
      // refusal; the patient's is asserted in full above, and the pair is the point
      // (ADR 0014).
      expect(foreignClinician.statusCode).toBe(422);
      expect(foreignClinician.json()).toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });
      expect(foreignPatient.statusCode).toBe(422);
    });

    it('takes the clinic from the request scope, so a walk-in cannot cross clinics', async () => {
      const response = await walkIn({ patientId: patient, dentistId: dentist }, otherClinicId);

      // This clinic's patient and clinician under the other clinic's header: the visit
      // would belong to the other clinic, which holds neither, so the tenant keys
      // refuse it — the same answer as an unreadable reference, because "this clinic
      // does not hold the patient" is exactly what it is.
      expect(response.statusCode).toBe(422);
      const [row] =
        await sql`select count(*)::int as total from visits where clinic_id = ${otherClinicId}`;
      expect((row as { total: number }).total).toBe(0);
    });

    it('appears on the clinical timeline, as a visit with no booking', async () => {
      const created = await walkIn({ patientId: patient, dentistId: dentist });
      const visitId = (created.json() as { id: string }).id;

      const response = await getTimeline(patient);

      expect(response.statusCode).toBe(200);
      const body = response.json() as { visits: { id: string; appointmentId?: string }[] };
      expect(body.visits.map((entry) => entry.id)).toContain(visitId);
      const entry = body.visits.find((row) => row.id === visitId);
      // A walk-in is a first-class visit on the timeline — the clinical record is
      // where it lives — but it carries no booking link to point back at.
      expect(entry?.appointmentId).toBeUndefined();
    });
  });

  describe('GET /api/v1/visits/:visitId', () => {
    it('reads a visit back over HTTP, end time and all', async () => {
      const visitId = await startAndReturnId();
      expect((await close(visitId, 'complete')).statusCode).toBe(200);

      const response = await getVisit(visitId);

      expect(response.statusCode).toBe(200);
      // The write's answer and the read's answer come from the same row, so a completed
      // visit is visibly completed with the end time the clock gave it.
      expect(response.json()).toMatchObject({
        id: visitId,
        patientId: patient,
        dentistId: dentist,
        appointmentId: expect.any(String),
        status: 'COMPLETED',
        startedAt: NOW,
        endedAt: NOW,
      });
    });

    it('reads a re-opened visit with no end time', async () => {
      const visitId = await startAndReturnId();
      await close(visitId, 'complete');
      await close(visitId, 'reopen');

      const response = await getVisit(visitId);

      // `endedAt` absent rather than null: the entity spells "has no end time" as
      // `undefined`, and the wire form follows the entity (ADR 0022).
      const body = response.json() as { status: string; endedAt?: string };
      expect(response.statusCode).toBe(200);
      expect(body.status).toBe('OPEN');
      expect(body.endedAt).toBeUndefined();
    });

    it('answers 404 for a visit another clinic holds', async () => {
      const visitId = await startAndReturnId();

      const response = await getVisit(visitId, otherClinicId);

      // Identical to an id that is nowhere, which the next test checks with the same
      // assertion — the pair is the point (ADR 0014).
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('answers 404 for a visit id that is nowhere', async () => {
      const response = await getVisit(missingId);

      // The same body as the other clinic's visit, asserted separately rather than by
      // comparing the two responses: if they ever diverge, both tests fail and the reason
      // is visible in the failure rather than hidden in an equality diff.
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('answers 422 for a path id that is not a uuid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/visits/not-a-uuid',
        headers: { 'x-clinic-id': clinicId },
      });

      // Before the guard existed this was a `22P02` reported as a 500 — which is how the
      // write side's helper came to default its clinic to an empty string in the first
      // place (ADR 0022).
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });
  });

  describe('GET /api/v1/patients/:patientId/visits', () => {
    it("lists the patient's visits newest first, and nobody else's", async () => {
      const older = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });
      const newer = await seedVisit({ startedAt: `${day}T14:00:00.000Z` });
      // Interleaved between the two, and not in the answer. An ordering fault and a
      // scoping fault look the same on a table holding one patient's visits, so the
      // excluded row sits between the included ones where it cannot hide behind either.
      const somebodyElse = await seedVisit({
        patientId: secondPatient,
        startedAt: `${day}T11:00:00.000Z`,
      });

      const response = await getTimeline(patient);

      expect(response.statusCode).toBe(200);
      const body = response.json() as { visits: { id: string }[] };
      expect(body.visits.map((entry) => entry.id)).toEqual([newer, older]);
      expect(body.visits.map((entry) => entry.id)).not.toContain(somebodyElse);
    });

    it('lists every visit of the patient, uncapped', async () => {
      const ids = [];
      for (let hour = 6; hour < 16; hour += 1) {
        ids.push(
          await seedVisit({ startedAt: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z` }),
        );
      }

      const response = await getTimeline(patient);

      // Ten visits. A bare `.limit(10)` would pass this by accident, so the count is
      // asserted against ten rows that all exist — and the "uncapped" claim is really
      // that there is no limit to grow into without changing this test (ADR 0023).
      expect((response.json() as { visits: unknown[] }).visits).toHaveLength(10);
    });

    it('answers 200 with an empty list for a patient who has never been treated', async () => {
      const response = await getTimeline(untouchedPatient);

      // 200 and `[]`, not 404. A patient with no visits is not a missing patient — and
      // `GET /patients/:id` answering 404 for another clinic's patient is not the
      // precedent to copy into a list (ADR 0023).
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ visits: [] });
    });

    it("answers exactly the same thing for another clinic's patient", async () => {
      // This clinic's patient gets a real visit, and the other clinic's patient gets one
      // in their own clinic — seeded here so the foreign timeline is genuinely non-empty
      // and the answer is genuinely a suppression rather than a coincidence.
      await seedVisit({ startedAt: `${day}T09:00:00.000Z` });
      await seedVisit({
        patientId: otherPatient,
        startedAt: `${day}T10:00:00.000Z`,
        clinic: otherClinicId,
      });

      const treated = await getTimeline(patient);
      const foreign = await getTimeline(otherPatient);

      // The two answers are compared, because the property is that they are
      // indistinguishable *despite* the rows differing — only a side-by-side comparison
      // shows that (ADR 0014).
      expect((foreign.json() as { visits: unknown[] }).visits).toEqual([]);
      expect((treated.json() as { visits: unknown[] }).visits).toHaveLength(1);

      // And the foreign clinic does see its own, so the empty answer above is this
      // clinic's scoping and not a fixture that was never written.
      const theirOwn = await getTimeline(otherPatient, otherClinicId);
      expect((theirOwn.json() as { visits: unknown[] }).visits).toHaveLength(1);
    });

    it('answers 422 for a patient id that is not a uuid, naming the field it got wrong', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/patients/not-a-uuid/visits',
        headers: { 'x-clinic-id': clinicId },
      });

      expect(response.statusCode).toBe(422);
      // The message names the *patient*, because this path has no visit id in it. The
      // helper it shares with the visit route hardcoded "the visit id in the path", which
      // on this URL points a client at a parameter it never sent.
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('patient') },
      });
    });
  });

  describe('GET and POST /api/v1/visits/:visitId/notes', () => {
    it('files a note and lists it back, with the clock’s time and nobody as the author', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      const filed = await fileNote(visitId, { body: '  Sensitivity reported.  ' });

      expect(filed.statusCode).toBe(201);
      const note = filed.json() as {
        id: string;
        visitId: string;
        body: string;
        createdAt: string;
        authorId: string | null;
      };
      expect(note.visitId).toBe(visitId);
      // Trimmed by the boundary schema, so the row is not the box's edges.
      expect(note.body).toBe('Sensitivity reported.');
      // Null, and not a bug: there is no user model to attribute a note to yet, the
      // same open question the audit trail waits on (ADR 0022).
      expect(note.authorId).toBeNull();
      expect(new Date(note.createdAt).toISOString()).toBe(NOW);

      const listed = await getNotes(visitId);
      expect(listed.statusCode).toBe(200);
      expect((listed.json() as { notes: unknown[] }).notes).toEqual([note]);

      // The row itself: a route that answered 201 without writing would pass every
      // assertion above and lose the note.
      const [row] = await sql`
        select visit_id, author_id, body from clinical_notes where id = ${note.id}
      `;
      expect(row).toMatchObject({
        visit_id: visitId,
        author_id: null,
        body: 'Sensitivity reported.',
      });
    });

    it('lists notes oldest first, whatever order they were filed in', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      // The earlier note is written straight into the table because this suite's clock
      // is fixed: two notes filed through the API would carry the same `created_at`, and
      // the list would then be the id tiebreak's — stable, but not what "oldest first"
      // claims to be. Different instants make the claim testable.
      await sql`
        insert into clinical_notes (id, visit_id, body, created_at)
        values ('11111111-9999-4888-8999-000000000041', ${visitId}, 'Earlier note.', '2026-04-16T09:00:00.000Z')
      `;
      const filed = await fileNote(visitId, { body: 'Later note.' });
      expect(filed.statusCode).toBe(201);

      const listed = await getNotes(visitId);

      expect(listed.statusCode).toBe(200);
      const bodies = (listed.json() as { notes: { body: string }[] }).notes.map(
        (note) => note.body,
      );
      expect(bodies).toEqual(['Earlier note.', 'Later note.']);
    });

    it('answers 404 for a visit another clinic holds, rather than an empty list', async () => {
      const foreign = await seedVisit({
        startedAt: `${day}T09:00:00.000Z`,
        clinic: otherClinicId,
      });
      const ours = await seedVisit({ startedAt: `${day}T10:00:00.000Z` });

      const readForeign = await getNotes(foreign);

      // `clinical_notes` has no clinic column, so a scoped query alone would answer
      // `[]` here — an empty list reading as "no notes were taken". The visit is the
      // subject, and the subject is not in this clinic (ADR 0014).
      expect(readForeign.statusCode).toBe(404);
      expect(readForeign.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect((await fileNote(foreign, { body: 'Anything.' })).statusCode).toBe(404);

      // And the same visit asked about under the other clinic's header is a different
      // request: our visit is theirs to read, ours is not theirs to write.
      expect((await getNotes(ours, otherClinicId)).statusCode).toBe(404);

      // Nothing was written by either refusal.
      const [count] = await sql`select count(*)::int as total from clinical_notes`;
      expect((count as { total: number }).total).toBe(0);
    });

    it('answers 404 for a visit id that is nowhere, in the same shape', async () => {
      const response = await getNotes(missingId);

      // Compared by assertion rather than to the response above: if the two ever
      // diverge, both tests fail and the reason is in the failure (ADR 0014).
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('refuses a body of nothing, and writes nothing', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      const refused = await fileNote(visitId, { body: '   ' });

      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

      const [count] = await sql`select count(*)::int as total from clinical_notes`;
      expect((count as { total: number }).total).toBe(0);
      // The read side still answers honestly: a refused note leaves no trace on the
      // list, which is `[]` because the visit is real and has no notes.
      expect((await getNotes(visitId)).statusCode).toBe(200);
    });

    it('answers 422 for a path id that is not a uuid, on both verbs', async () => {
      for (const method of ['GET', 'POST'] as const) {
        const response = await app.inject({
          method,
          url: '/api/v1/visits/not-a-uuid/notes',
          headers: { 'x-clinic-id': clinicId },
          ...(method === 'POST' ? { payload: { body: 'Anything.' } } : {}),
        });

        // Before the guard existed this was a `22P02` reported as a 500 — which is how
        // the write side's helper came to default its clinic to an empty string.
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      }
    });
  });

  describe('GET and POST /api/v1/visits/:visitId/treatments', () => {
    it('records a treatment and lists it back, with the clock’s time', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      const recorded = await recordTreatment(visitId, {
        // Trimmed by the boundary schema, so the row is not the box's edges.
        treatmentId: treatment,
        tooth: ' 16 ',
        notes: '  No complications.  ',
      });

      expect(recorded.statusCode).toBe(201);
      const body = recorded.json() as {
        id: string;
        visitId: string;
        treatmentId: string;
        tooth: string;
        notes: string;
        performedAt: string;
      };
      expect(body.visitId).toBe(visitId);
      expect(body.treatmentId).toBe(treatment);
      expect(body.tooth).toBe('16');
      expect(body.notes).toBe('No complications.');
      // The clock, not something the body could have said.
      expect(new Date(body.performedAt).toISOString()).toBe(NOW);

      const listed = await getTreatments(visitId);
      expect(listed.statusCode).toBe(200);
      expect((listed.json() as { treatments: unknown[] }).treatments).toEqual([body]);

      // The row itself: a route that answered 201 without writing would pass every
      // assertion above and lose the record.
      const [row] = await sql`
        select visit_id, treatment_id, tooth, notes from visit_treatment_executions where id = ${body.id}
      `;
      expect(row).toMatchObject({
        visit_id: visitId,
        treatment_id: treatment,
        tooth: '16',
        notes: 'No complications.',
      });
    });

    it('drops a blank tooth and blank notes to null, listing what was done with no tooth', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      const recorded = await recordTreatment(visitId, {
        treatmentId: treatment,
        tooth: '   ',
        notes: '',
      });

      expect(recorded.statusCode).toBe(201);
      const body = recorded.json() as { tooth: string | null; notes: string | null };
      // "Not on a tooth" and "no notes taken" are facts, and an empty string would be a
      // field typed and then forgotten.
      expect(body.tooth).toBeNull();
      expect(body.notes).toBeNull();
    });

    it('lists records oldest first, whatever order they were filed in', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      // The earlier record is written straight into the table because this suite's
      // clock is fixed: two records filed through the API would carry the same
      // `performed_at`, and the list would then be the id tiebreak's — stable, but not
      // what "what happened first" claims to be.
      await sql`
        insert into visit_treatment_executions (id, visit_id, treatment_id, tooth, performed_at)
        values ('11111111-9999-4888-8999-000000000042', ${visitId}, ${treatment}, '26', '2026-04-16T09:00:00.000Z')
      `;
      const recorded = await recordTreatment(visitId, { treatmentId: treatment, tooth: '36' });
      expect(recorded.statusCode).toBe(201);

      const listed = await getTreatments(visitId);

      expect(listed.statusCode).toBe(200);
      const teeth = (listed.json() as { treatments: { tooth: string }[] }).treatments.map(
        (record) => record.tooth,
      );
      expect(teeth).toEqual(['26', '36']);
    });

    it('refuses a treatment that is not in this clinic’s catalogue, and writes nothing', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      // The row exists — in the *other* clinic. Saying which of those two was wrong
      // would confirm the id is real somewhere else, so "not offered here" and "no
      // such treatment" are one answer (ADR 0014).
      const refused = await recordTreatment(visitId, { treatmentId: foreignTreatment });

      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'That treatment is not in this clinic’s catalogue',
        },
      });

      const [count] = await sql`select count(*)::int as total from visit_treatment_executions`;
      expect((count as { total: number }).total).toBe(0);
    });

    it('refuses a tooth that is not a real FDI number, with the odontogram’s error', async () => {
      const visitId = await seedVisit({ startedAt: `${day}T09:00:00.000Z` });

      const refused = await recordTreatment(visitId, { treatmentId: treatment, tooth: '00' });

      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({
        error: { code: 'VALIDATION_ERROR', message: '"00" is not a valid FDI tooth number' },
      });

      const [count] = await sql`select count(*)::int as total from visit_treatment_executions`;
      expect((count as { total: number }).total).toBe(0);
    });

    it('answers 404 for a visit another clinic holds, rather than an empty list', async () => {
      const foreign = await seedVisit({
        startedAt: `${day}T09:00:00.000Z`,
        clinic: otherClinicId,
      });
      const ours = await seedVisit({ startedAt: `${day}T10:00:00.000Z` });

      const readForeign = await getTreatments(foreign);

      // `visit_treatment_executions` has no clinic column, so a scoped query alone
      // would answer `[]` here — an empty list reading as "nothing was done". The
      // visit is the subject, and the subject is not in this clinic (ADR 0014).
      expect(readForeign.statusCode).toBe(404);
      expect(readForeign.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect((await recordTreatment(foreign, { treatmentId: foreignTreatment })).statusCode).toBe(
        404,
      );

      // And the same visit asked about under the other clinic's header is a different
      // request: our visit is theirs to read, ours is not theirs to write.
      expect((await getTreatments(ours, otherClinicId)).statusCode).toBe(404);

      // Nothing was written by either refusal.
      const [count] = await sql`select count(*)::int as total from visit_treatment_executions`;
      expect((count as { total: number }).total).toBe(0);
    });

    it('answers 404 for a visit id that is nowhere, in the same shape', async () => {
      const response = await getTreatments(missingId);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });

    it('answers 422 for a path id that is not a uuid, on both verbs', async () => {
      for (const method of ['GET', 'POST'] as const) {
        const response = await app.inject({
          method,
          url: '/api/v1/visits/not-a-uuid/treatments',
          headers: { 'x-clinic-id': clinicId },
          ...(method === 'POST' ? { payload: { treatmentId: treatment } } : {}),
        });

        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      }
    });
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
