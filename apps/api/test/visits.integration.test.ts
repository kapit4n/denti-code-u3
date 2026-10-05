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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { DrizzleUnitOfWork } from '../src/infrastructure/persistence/postgres/unit-of-work.js';
import { DrizzleAppointmentRepository } from '../src/infrastructure/persistence/repositories/appointment-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';
import { startVisit, type AppointmentRepository } from '@denti-code-u3/domain';
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

  const clinicId = asClinicId('1a1a1111-1111-4111-8111-111111111111');
  const otherClinicId = asClinicId('2b2b1111-1111-4111-8111-111111111111');

  const dentists = {
    alice: '3c3c1111-1111-4111-8111-111111111111',
    other: '3c3c2222-2222-4222-8222-222222222222',
  };
  const patients = {
    ana: '4d4d1111-1111-4111-8111-111111111111',
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

  const start = (appointmentId: AppointmentId, seed = 1, clinic: ClinicId = clinicId) =>
    startVisit(clinic, appointmentId, {
      unitOfWork,
      clock: { now: () => NOW },
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
        (${patients.foreign}, ${otherClinicId}, 'Foreign', 'Patient')
      on conflict (id) do nothing
    `;
  });

  beforeEach(clearFixtures);

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
