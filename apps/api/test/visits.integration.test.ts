/**
 * Integration test: starting a visit.
 *
 * Four properties here cannot be tested without a real PostgreSQL, and each of them is
 * the reason this file exists rather than another unit test:
 *
 *  - **The two writes are one transaction.** Asserted by making the second write fail
 *    and checking the first is not left behind. A unit test can only inspect a fake's
 *    idea of a rollback; this watches the table.
 *  - **The unique index refuses a second visit for the same appointment**, which is the
 *    race the domain cannot see: two requests both read an appointment with no
 *    `visit_id` and both build a valid visit. Fired concurrently here, which is the only
 *    way two writers are ever visible at once.
 *  - **The tenant foreign keys hold.** Migration 0003 gave `visits` the same composite
 *    `(id, clinic_id)` keys `appointments` has, and the claim that a visit cannot hold
 *    another clinic's patient is only worth something if the database says so.
 *  - **`restrict` on both links.** An appointment with a visit cannot be deleted, and a
 *    visit cannot be deleted either — which is what stops the two rows from being
 *    separated after the fact.
 *
 * Run it with:
 *
 *   pnpm run db:up
 *   pnpm run test:integration
 *
 * It uses `TEST_DATABASE_URL` so it can never touch development data.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { DrizzleUnitOfWork } from '../src/infrastructure/persistence/postgres/unit-of-work.js';
import { DrizzleAppointmentRepository } from '../src/infrastructure/persistence/repositories/appointment-repository.js';
import { DrizzleVisitRepository } from '../src/infrastructure/persistence/repositories/visit-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';
import {
  completeVisitRecord,
  getVisit,
  listVisitsForPatient,
  reopenVisitRecord,
  startVisit,
  type AppointmentRepository,
} from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type AppointmentId,
  type ClinicId,
  type IsoDateTime,
} from '@denti-code-u3/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('starting a visit (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 6 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;
  const unitOfWork = new DrizzleUnitOfWork(db);
  const appointments = new DrizzleAppointmentRepository(db);
  const visitsRepository = new DrizzleVisitRepository(db);

  /**
   * The end time the two closing use cases are given.
   *
   * A fixed instant that is deliberately *not* "now", so the row can be checked for
   * having taken the domain's decision rather than the repository's own clock reading.
   */
  const CLOSED_AT = '2026-04-09T14:47:12.000Z' as IsoDateTime;

  const clinicId = asClinicId('1a1a1111-1111-4111-8111-111111111111');
  const otherClinicId = asClinicId('2b2b1111-1111-4111-8111-111111111111');

  const dentists = {
    alice: '3c3c1111-1111-4111-8111-111111111111',
    other: '3c3c2222-2222-4222-8222-222222222222',
  };
  const patients = {
    ana: '4d4d1111-1111-4111-8111-111111111111',
    /**
     * A second patient in *this* clinic, and a third who has never been treated.
     *
     * Both exist for the timeline's sake. With one patient in the clinic, a timeline test
     * cannot tell "ordered correctly" from "returned everything": ordering and scoping
     * break the same way on a single row, so the read side needs a patient of its own to
     * exclude and a patient with no visits at all.
     */
    bruno: '4d4d3333-3333-4333-8333-333333333333',
    untouched: '4d4d4444-4444-4444-8444-444444444444',
    foreign: '4d4d2222-2222-4222-8222-222222222222',
  };
  const chairs = {
    one: '5e5e1111-1111-4111-8111-111111111111',
    other: '5e5e2222-2222-4222-8222-222222222222',
  };

  const day = '2026-04-09';
  const at = (time: string): IsoDateTime => `${day}T${time}:00.000Z` as IsoDateTime;
  const NOW = at('14:30');

  /**
   * Fixtures are cleared by breaking the links first, and in three statements.
   *
   * **There is no order in which these two rows can simply be deleted.** Both links are
   * `on delete restrict` (ADR 0021), and that was the point: deleting a visit leaves an
   * appointment marked `IN_TREATMENT` with no record behind it, and deleting the
   * appointment leaves a treated visit reading as a walk-in. The first version of this
   * teardown deleted the visits first and was refused by
   * `appointments_visit_id_visits_id_fk` on the very first run — which is the constraint
   * working, and worth recording rather than routing around.
   *
   * So the links are cleared, then the rows. That is also the honest shape of the rule:
   * an appointment with a visit is cancelled, not deleted; a visit is closed, not
   * deleted. A test fixture has no status transitions to offer, so it does by hand what
   * the domain would do through them.
   */
  const clearFixtures = async () => {
    await sql`update appointments set visit_id = null where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`update visits set appointment_id = null where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`delete from visits where clinic_id in (${clinicId}, ${otherClinicId})`;
    await sql`delete from appointments where clinic_id in (${clinicId}, ${otherClinicId})`;
  };

  const book = async (options: {
    readonly clinic?: string;
    readonly dentist?: string | null;
    readonly chair?: string | null;
    readonly patient?: string;
    readonly startsAt: string;
    readonly durationMinutes?: number;
    readonly status?: string;
  }): Promise<AppointmentId> => {
    const [row] = await sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values (
        ${options.clinic ?? clinicId},
        ${options.patient ?? patients.ana},
        ${options.dentist === undefined ? dentists.alice : options.dentist},
        ${options.chair === undefined ? chairs.one : options.chair},
        ${options.startsAt},
        ${options.durationMinutes ?? 45},
        ${options.status ?? 'ARRIVED'}
      )
      returning id
    `;
    return asAppointmentId((row as { id: string }).id);
  };

  /** A deterministic id per call, so a test can name the visit it expects. */
  const idsFrom = (seed: number) => {
    let sequence = seed;
    return () => asVisitId(`6f6f0000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`);
  };

  /**
   * Start a visit from a booking.
   *
   * `startedAt` exists because `startVisit` takes its start time from the clock, and one
   * fixed `NOW` gives every visit the *same* `started_at`. That is harmless for every other
   * test here and fatal for the timeline: three visits tied on the column being ordered
   * have no defined order, so the timeline test would be asserting PostgreSQL's tie-break
   * rather than the repository's `orderBy` — and would keep passing if the `orderBy` were
   * deleted outright. Passing each visit its own start time is what makes the ordering
   * claim testable.
   */
  const start = (
    appointmentId: AppointmentId,
    seed = 1,
    clinic: ClinicId = clinicId,
    startedAt: IsoDateTime = NOW,
  ) =>
    startVisit(clinic, appointmentId, {
      unitOfWork,
      clock: { now: () => startedAt },
      newId: idsFrom(seed),
    });

  const countVisits = async (appointmentId: AppointmentId) => {
    const [row] =
      await sql`select count(*)::int as total from visits where appointment_id = ${appointmentId}`;
    return (row as { total: number }).total;
  };

  /** Every visit in this test's clinic, for the rows no appointment id could find. */
  const countVisitsInClinic = async () => {
    const [row] =
      await sql`select count(*)::int as total from visits where clinic_id = ${clinicId}`;
    return (row as { total: number }).total;
  };

  /**
   * The row as it is stored, with both timestamps read as instants.
   *
   * `postgres` hands a `timestamptz` back as a string here, so the comparison is on
   * `new Date(value).toISOString()` rather than on a `Date` the cast pretended was
   * there — the first version of this helper asserted the column was a `Date` and
   * failed on `toISOString is not a function`, which is the cast being wrong rather
   * than the column.
   */
  const readVisit = async (visitId: string) => {
    const [row] = await sql`select status, started_at, ended_at from visits where id = ${visitId}`;
    const stored = row as { status: string; started_at: string | null; ended_at: string | null };
    const instant = (value: string | null) =>
      value === null ? null : new Date(value).toISOString();

    return {
      status: stored.status,
      startedAt: instant(stored.started_at),
      endedAt: instant(stored.ended_at),
    };
  };

  const closureDependencies = {
    visits: visitsRepository,
    clock: { now: () => CLOSED_AT },
  };

  const readAppointment = async (appointmentId: AppointmentId) => {
    const [row] = await sql`select status, visit_id from appointments where id = ${appointmentId}`;
    return row as { status: string; visit_id: string | null };
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Visit Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Visit Other', 'UTC', 'USD')
      on conflict (id) do nothing
    `;

    await sql`
      insert into dentists (id, clinic_id, full_name)
      values
        (${dentists.alice}, ${clinicId}, 'Dr Alice'),
        (${dentists.other}, ${otherClinicId}, 'Dr Foreign')
      on conflict (id) do nothing
    `;

    await sql`
      insert into chairs (id, clinic_id, name)
      values
        (${chairs.one}, ${clinicId}, 'Chair 1'),
        (${chairs.other}, ${otherClinicId}, 'Other Chair')
      on conflict (id) do nothing
    `;

    await sql`
      insert into patients (id, clinic_id, first_name, last_name)
      values
        (${patients.ana}, ${clinicId}, 'Ana', 'Aguilar'),
        (${patients.foreign}, ${otherClinicId}, 'Foreign', 'Patient'),
        (${patients.bruno}, ${clinicId}, 'Bruno', 'Baptista'),
        (${patients.untouched}, ${clinicId}, 'Carla', 'Costa')
      on conflict (id) do nothing
    `;
  });

  beforeEach(clearFixtures);

  /**
   * Put the clinicians back.
   *
   * One test deletes a dentist on purpose, to see what `on delete set null` leaves behind.
   * That deletion is permanent and `clearFixtures` does not restore rows — only visits and
   * appointments — so without this the next four tests failed on a missing clinician,
   * which is how a perfectly good fixture turns into a mystery.
   */
  afterEach(async () => {
    await sql`
      insert into dentists (id, clinic_id, full_name)
      values
        (${dentists.alice}, ${clinicId}, 'Dr Alice'),
        (${dentists.other}, ${otherClinicId}, 'Dr Foreign')
      on conflict (id) do nothing
    `;
  });

  afterAll(async () => {
    await clearFixtures();
    await sql.end({ timeout: 5 });
  });

  it('writes the visit and moves its appointment', async () => {
    const appointmentId = await book({ startsAt: at('14:00') });

    const started = await start(appointmentId);

    expect(started.visit).toMatchObject({
      clinicId,
      patientId: asPatientId(patients.ana),
      dentistId: asDentistId(dentists.alice),
      chairId: asChairId(chairs.one),
      appointmentId,
      status: 'OPEN',
      startedAt: NOW,
    });
    expect(started.appointment.status).toBe('IN_TREATMENT');

    // Read back through the table rather than trusting the returned entities: the
    // point of the test is what the database holds.
    const appointment = await readAppointment(appointmentId);
    expect(appointment.status).toBe('IN_TREATMENT');
    expect(appointment.visit_id).toBe(started.visit.id);
  });

  it('refuses a second visit for the same appointment when two requests race', async () => {
    const appointmentId = await book({ startsAt: at('15:00') });

    // Both are started at once, which is the only way two writers are visible to each
    // other. Each has its own id and its own connection from the pool.
    const outcomes = await Promise.allSettled([start(appointmentId, 10), start(appointmentId, 20)]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    // Exactly one. Asserting both halves matters: a test that only checked "one
    // fulfilled" would also pass if both had, and the second would be a second visit
    // for one booking — the thing the unique index exists to refuse.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'DUPLICATED_RECORD',
    });
    expect(await countVisits(appointmentId)).toBe(1);

    // And the loser did not move the appointment a second time or leave it pointing at
    // a visit that was rolled back.
    const appointment = await readAppointment(appointmentId);
    expect(appointment.visit_id).toBe(
      (fulfilled[0] as PromiseFulfilledResult<{ visit: { id: string } }>).value.visit.id,
    );
  });

  it('rolls the visit back when the appointment cannot be moved', async () => {
    const appointmentId = await book({ startsAt: at('16:00') });

    // The visit row is written first, so a failure moving the appointment is the case
    // that proves the transaction: without it there would be an open visit here, and
    // the appointment would still read as waiting.
    // Every method stays real except `becomeVisit`. A proxy says exactly that, and it
    // matters that the read is real: a repository is a class instance, so
    // `{ ...repositories.appointments }` copies an object with no own methods and the
    // failure becomes "findById is not a function" — a failure that says nothing about
    // rollback. That is what the first version of this test asserted against, and it
    // would have kept passing as a "test" while proving nothing.
    const withoutBecomeVisit = (real: AppointmentRepository): AppointmentRepository =>
      new Proxy(real, {
        get: (target, property, receiver) =>
          property === 'becomeVisit'
            ? async () => {
                throw new Error('the second write failed');
              }
            : Reflect.get(target, property, receiver),
      });

    await expect(
      startVisit(clinicId, appointmentId, {
        unitOfWork: {
          transaction: (work) =>
            unitOfWork.transaction((repositories) =>
              work({
                ...repositories,
                appointments: withoutBecomeVisit(repositories.appointments),
              }),
            ),
        },
        clock: { now: () => NOW },
        newId: idsFrom(30),
      }),
    ).rejects.toThrow('the second write failed');

    expect(await countVisits(appointmentId)).toBe(0);

    const appointment = await readAppointment(appointmentId);
    expect(appointment.status).toBe('ARRIVED');
    expect(appointment.visit_id).toBeNull();
  });

  it('refuses an appointment belonging to another clinic', async () => {
    // Every reference has to belong to the other clinic: the appointment's own
    // same-clinic foreign keys refuse a booking that mixes the two, which is the
    // appointment table's half of the same rule these tests cover for visits.
    const appointmentId = await book({
      clinic: otherClinicId,
      patient: patients.foreign,
      dentist: dentists.other,
      chair: chairs.other,
      startsAt: at('17:00'),
    });

    // Asked about the *other* clinic's booking while scoped to this one. The booking is
    // real and this clinic does not hold it, so the answer must not distinguish the two
    // cases (ADR 0014).
    await expect(start(appointmentId, 40, clinicId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await countVisits(appointmentId)).toBe(0);
  });

  it('refuses a booking whose dentist has left the clinic', async () => {
    // `dentist_id` is null because the row the dentist referenced is gone — the state a
    // clinician's departure leaves behind, and the one a visit must not be attributed
    // to.
    const appointmentId = await book({ startsAt: at('18:00'), dentist: null });

    await expect(start(appointmentId, 50)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await countVisits(appointmentId)).toBe(0);
  });

  it('hands the domain the link it needs to refuse a duplicate', async () => {
    const appointmentId = await book({ startsAt: at('19:00') });

    // Before anything is started, the entity carries no visit link at all. Absent
    // rather than null, because `undefined` is how "not started" is spelled on this
    // entity everywhere else.
    expect((await appointments.findById(clinicId, appointmentId))?.visitId).toBeUndefined();

    const started = await start(appointmentId, 60);

    // And afterwards it carries one. This is the assertion the whole duplicate rule
    // rests on: `startVisitFromAppointment` refuses an appointment that already has a
    // visit, so a projection that omitted `visit_id` would leave that rule dead and
    // every sequential duplicate to be caught by the unique index instead — answering
    // the same way, while the domain check silently did nothing. It went unnoticed
    // because the sequential and the raced case answer identically at the boundary.
    expect((await appointments.findById(clinicId, appointmentId))?.visitId).toBe(started.visit.id);
  });

  it('refuses an appointment that already became a visit', async () => {
    const appointmentId = await book({ startsAt: at('19:00') });
    await start(appointmentId, 60);

    await expect(start(appointmentId, 70)).rejects.toMatchObject({ code: 'DUPLICATED_RECORD' });
    expect(await countVisits(appointmentId)).toBe(1);
  });

  describe('closing a visit', () => {
    it("writes the clock's end time into the row, not one of its own", async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 80);

      const completed = await completeVisitRecord(clinicId, started.visit.id, closureDependencies);

      expect(completed).toMatchObject({ status: 'COMPLETED', endedAt: CLOSED_AT });

      // The row, not the returned entity. Before ADR 0022 the repository stamped its own
      // `new Date()`, so the answer carried the clock's time while the row carried the
      // wall clock at the moment the statement ran — two truths about one row, differing
      // by however long the request took, and a test with a fixed clock passing against
      // the use case while failing against the table.
      const row = await readVisit(started.visit.id);
      expect(row.status).toBe('COMPLETED');
      expect(row.endedAt).toBe(CLOSED_AT);
      expect(row.startedAt).toBe(NOW);
    });

    it('leaves the appointment reading IN_TREATMENT, which is the decision', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 81);

      await completeVisitRecord(clinicId, started.visit.id, closureDependencies);

      // ADR 0022, Decision 2, verified against the table rather than asserted in a
      // comment. The booking is completed through its own endpoint — the quick panel's
      // "Complete" — and until then the agenda still draws this appointment as in
      // treatment and the dashboard still counts the patient in its `inTreatment` total.
      // Coupling the two would need a `COMPLETED → IN_TREATMENT` edge on a table where
      // `COMPLETED` is terminal, and that edge would surface as a button on every
      // completed appointment in the clinic.
      const appointment = await readAppointment(appointmentId);
      expect(appointment.status).toBe('IN_TREATMENT');
      expect(appointment.visit_id).toBe(started.visit.id);
    });

    it('re-opens a closed visit and clears the end time it had', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 82);
      await completeVisitRecord(clinicId, started.visit.id, closureDependencies);

      const reopened = await reopenVisitRecord(clinicId, started.visit.id, closureDependencies);

      expect(reopened).toMatchObject({ status: 'OPEN' });
      expect(reopened.endedAt).toBeUndefined();

      const row = await readVisit(started.visit.id);
      expect(row.status).toBe('OPEN');
      // Null in the row rather than left behind: a visit claiming to be open while still
      // holding the end of a closing that no longer stands would give the patient
      // profile two stories about one row.
      expect(row.endedAt).toBeNull();
      // The start is untouched by either transition — a re-opened visit did not begin
      // again.
      expect(row.startedAt).toBe(NOW);
    });

    it('refuses to complete a completed visit, and writes nothing', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 83);
      await completeVisitRecord(clinicId, started.visit.id, closureDependencies);

      await expect(
        completeVisitRecord(clinicId, started.visit.id, closureDependencies),
      ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

      // The end time of the first completion survives the refused second one — the
      // refusal is a refusal, not a rewrite.
      const row = await readVisit(started.visit.id);
      expect(row.endedAt).toBe(CLOSED_AT);
    });

    it('refuses to re-open a visit that is already open', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 84);

      await expect(
        reopenVisitRecord(clinicId, started.visit.id, closureDependencies),
      ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

      const row = await readVisit(started.visit.id);
      expect(row.status).toBe('OPEN');
      expect(row.endedAt).toBeNull();
    });

    it('answers NOT_FOUND for a visit belonging to another clinic', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 85);

      await expect(
        completeVisitRecord(otherClinicId, started.visit.id, closureDependencies),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        reopenVisitRecord(otherClinicId, started.visit.id, closureDependencies),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      // Untouched by both attempts: the same answer as an id that is nowhere (ADR 0014).
      const row = await readVisit(started.visit.id);
      expect(row.status).toBe('OPEN');
      expect(row.endedAt).toBeNull();
    });

    it('closes the visit once when two requests do it at the same time', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 86);

      const outcomes = await Promise.allSettled([
        completeVisitRecord(clinicId, started.visit.id, closureDependencies),
        completeVisitRecord(clinicId, started.visit.id, closureDependencies),
      ]);

      // Both succeed, and that is the honest answer rather than a missing guard:
      // completing a visit is idempotent — the second request asks for a state the row
      // is already in. Neither is refused, so there is nothing here to assert beyond the
      // row being closed once with one end time, and no half-written state between them.
      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
      const row = await readVisit(started.visit.id);
      expect(row.status).toBe('COMPLETED');
      expect(row.endedAt).toBe(CLOSED_AT);
      expect(await countVisits(appointmentId)).toBe(1);
    });
  });

  describe('reading a visit', () => {
    it('reads back the visit it wrote, with the end time it decided', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 90);
      await completeVisitRecord(clinicId, started.visit.id, closureDependencies);

      const found = await getVisit(clinicId, started.visit.id, {
        visits: visitsRepository,
      });

      // The round trip the write side's tests could not make: the entity the domain built
      // is compared against the entity the repository reads, and the two agree. Before the
      // read side existed, the row was only ever compared against itself.
      expect(found).toMatchObject({
        id: started.visit.id,
        clinicId,
        patientId: asPatientId(patients.ana),
        appointmentId,
        status: 'COMPLETED',
        startedAt: NOW,
        endedAt: CLOSED_AT,
      });
    });

    it('reads a re-opened visit with no end time', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 91);
      await completeVisitRecord(clinicId, started.visit.id, closureDependencies);
      await reopenVisitRecord(clinicId, started.visit.id, closureDependencies);

      const found = await getVisit(clinicId, started.visit.id, { visits: visitsRepository });

      // Cleared in the row, not merely absent from the entity the use case returned. This
      // is the pair of assertions session 24 could not write, because the read side did
      // not exist to write them against.
      expect(found.status).toBe('OPEN');
      expect(found.endedAt).toBeUndefined();
    });

    it('carries a departed clinician as null rather than dropping the key', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 92);

      // The clinician leaves: `on delete set null` takes the link and keeps the visit.
      // `${dentists.alice}` rather than `dentists.own` because the fixture key was renamed
      // in session 24 and this line kept the old name — postgres-js refuses an
      // `undefined` parameter outright, which is at least a louder failure than a null.
      await sql`delete from dentists where id = ${dentists.alice}`;

      const found = await getVisit(clinicId, started.visit.id, { visits: visitsRepository });

      // A visit outlives the employment that produced it. Omitting the key would make
      // this indistinguishable from a visit that was never asked about a clinician
      // (ADR 0021), and the entity type says the difference is real.
      expect('dentistId' in found).toBe(true);
      expect(found.dentistId).toBeNull();
      expect(found.status).toBe('OPEN');
    });

    it('refuses a visit belonging to another clinic', async () => {
      const appointmentId = await book({ startsAt: at('14:00') });
      const started = await start(appointmentId, 93);

      await expect(
        getVisit(otherClinicId, started.visit.id, { visits: visitsRepository }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("lists a patient's visits newest first, and nobody else's", async () => {
      const patientId = patients.ana;
      // Insertion order is 94, 95, 96 and the answer must be the reverse of it, so
      // dropping `orderBy` — which returns insertion order here — is caught.
      const older = await start(
        await book({ startsAt: at('09:00'), patient: patientId }),
        94,
        clinicId,
        at('09:00'),
      );
      const newer = await start(
        await book({ startsAt: at('14:00'), patient: patientId }),
        95,
        clinicId,
        at('14:00'),
      );
      // A third visit for somebody else, inserted between the two above and *not* part of
      // the answer. An ordering bug and a scoping bug look identical on a table holding
      // one patient's visits, so the excluded row is interleaved to separate them.
      await start(
        await book({ startsAt: at('11:00'), patient: patients.bruno }),
        96,
        clinicId,
        at('11:00'),
      );

      const list = await listVisitsForPatient(clinicId, asPatientId(patientId), {
        visits: visitsRepository,
      });

      // The order a clinician reads a history in. Insertion order is 94, 95, 96; the
      // answer is 95, 94 with 96 absent. So dropping `orderBy` (insertion order) and
      // dropping the patient filter (96 included) are both caught, and neither is caught by
      // the other.
      expect(list.map((entry) => entry.id)).toEqual([newer.visit.id, older.visit.id]);
    });

    it('lists nothing for a patient who has never been treated, and does not refuse', async () => {
      const list = await listVisitsForPatient(clinicId, asPatientId(patients.untouched), {
        visits: visitsRepository,
      });

      // `[]`, not `NOT_FOUND`. A patient with no visits is not a missing patient, and
      // `GET /patients/:id` answering 404 for another clinic's patient is not a precedent
      // to copy into a list (ADR 0023).
      expect(list).toEqual([]);
    });

    it("lists nothing for another clinic's patient, identically", async () => {
      // The other clinic's fixture patient, asked about from this clinic. The row exists
      // and belongs elsewhere.
      const here = await listVisitsForPatient(clinicId, asPatientId(patients.foreign), {
        visits: visitsRepository,
      });
      const there = await listVisitsForPatient(otherClinicId, asPatientId(patients.foreign), {
        visits: visitsRepository,
      });

      // Compared side by side on purpose: the property that matters is that a caller
      // cannot tell "no visits" from "not your patient", and only a comparison shows that
      // (ADR 0014).
      expect(here).toEqual([]);
      expect(there).toEqual([]);
    });
  });

  describe('the guarantees the schema now holds', () => {
    it("refuses a visit naming another clinic's patient", async () => {
      await expect(
        sql`
          insert into visits (clinic_id, patient_id, dentist_id, chair_id, status)
          values (${clinicId}, ${patients.foreign}, ${dentists.alice}, ${chairs.one}, 'OPEN')
        `,
      ).rejects.toMatchObject({ code: '23503' });

      // Counted by clinic rather than by appointment: the whole point of this test is
      // that the row was never created, and a row naming an appointment that does not
      // exist would not be findable by appointment id.
      expect(await countVisitsInClinic()).toBe(0);
    });

    it("refuses a visit naming another clinic's dentist", async () => {
      await expect(
        sql`
          insert into visits (clinic_id, patient_id, dentist_id, chair_id, status)
          values (${clinicId}, ${patients.ana}, ${dentists.other}, ${chairs.one}, 'OPEN')
        `,
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('refuses a visit naming an appointment that does not exist', async () => {
      // Before migration 0003 this was a legal row: the unique index on
      // `appointment_id` was enforcing "at most one visit per appointment" against a
      // column free to name nothing at all.
      await expect(
        sql`
          insert into visits (clinic_id, patient_id, dentist_id, chair_id, appointment_id, status)
          values (
            ${clinicId}, ${patients.ana}, ${dentists.alice}, ${chairs.one},
            ${'7a7a0000-0000-4000-8000-000000000001'}, 'OPEN'
          )
        `,
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('refuses deleting an appointment that has a visit', async () => {
      const appointmentId = await book({ startsAt: at('20:00') });
      await start(appointmentId, 80);

      // `set null` here would leave a treated visit reading as a walk-in. The refusal
      // is the honest answer: an appointment with a visit is cancelled, not deleted.
      await expect(sql`delete from appointments where id = ${appointmentId}`).rejects.toMatchObject(
        {
          code: '23503',
        },
      );
      expect(await countVisits(appointmentId)).toBe(1);
    });

    it('refuses deleting a visit that an appointment points at', async () => {
      const appointmentId = await book({ startsAt: at('21:00') });
      const started = await start(appointmentId, 90);

      // The other direction of the pair, which would otherwise leave an appointment
      // marked IN_TREATMENT with no clinical record behind it.
      await expect(sql`delete from visits where id = ${started.visit.id}`).rejects.toMatchObject({
        code: '23503',
      });
    });

    it('keeps a visit when its dentist is deleted, with the link nulled', async () => {
      const appointmentId = await book({ startsAt: at('22:00') });
      const started = await start(appointmentId, 100);

      // The other side of the split invariant (ADR 0021): creation required a
      // clinician, and the record outlives the employment.
      const departingId = '3c3c3333-3333-4333-8333-333333333333';
      await sql`
        insert into dentists (id, clinic_id, full_name)
        values (${departingId}, ${clinicId}, 'Dr Departing')
        on conflict (id) do nothing
      `;
      await sql`
        update visits set dentist_id = ${departingId} where id = ${started.visit.id}
      `;
      await sql`delete from dentists where id = ${departingId}`;

      const [row] = await sql`select dentist_id from visits where id = ${started.visit.id}`;
      expect((row as { dentist_id: string | null }).dentist_id).toBeNull();
      // The visit itself is untouched, which is the whole point of `set null (column)`
      // rather than plain `set null`: the row also holds `clinic_id`, and nulling that
      // would have been refused by its own NOT NULL.
      expect(row).toBeDefined();
      expect(await countVisits(appointmentId)).toBe(1);
    });
  });
});
