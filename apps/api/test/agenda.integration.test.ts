/**
 * Integration test: reading the agenda.
 *
 * The agenda is the screen a receptionist works from, and its query has three
 * properties that are easy to get subtly wrong and impossible to eyeball:
 *
 *  - **The window is half-open.** Paging through consecutive days must not return
 *    the midnight appointment twice, and 09:00–09:30 beside 09:30–10:00 is a
 *    legal day, not an overlap. This is the same interval the database's exclusion
 *    constraints use, so if the two disagreed the calendar would show a free slot
 *    the database considers taken.
 *  - **Overlap, not start time.** A booking that began before the window and runs
 *    into it is on today's agenda.
 *  - **Clinic scope and withdrawn patients.** One clinic's book is not public, and
 *    an anonymised patient does not appear on a working screen.
 *
 * Exercised through the repository against a real PostgreSQL, because the failure
 * mode is an interval comparison: a unit test with hand-written dates would keep
 * passing while the SQL dropped or duplicated appointments.
 *
 * Run it with:
 *
 *   pnpm run db:up
 *   pnpm run test:integration
 *
 * It uses `TEST_DATABASE_URL` so it can never touch development data.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { DrizzleAppointmentRepository } from '../src/infrastructure/persistence/repositories/appointment-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';
import { asChairId, asClinicId, asDentistId, type IsoDateTime } from '@denti-code-u3/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('agenda reads (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 4 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;
  const repository = new DrizzleAppointmentRepository(db);

  const clinicId = asClinicId('dddd1111-1111-4111-8111-111111111111');
  const otherClinicId = asClinicId('dddd2222-2222-4222-8222-222222222222');

  const dentists = {
    alice: 'eeee1111-1111-4111-8111-111111111111',
    bruno: 'eeee2222-2222-4222-8222-222222222222',
    /** Deleted before the test runs: its appointments must survive with a null dentist. */
    departed: 'eeee3333-3333-4333-8333-333333333333',
  };

  const patients = {
    ana: 'ffff1111-1111-4111-8111-111111111111',
    ben: 'ffff2222-2222-4222-8222-222222222222',
    withdrawn: 'ffff3333-3333-4333-8333-333333333333',
    otherClinic: 'ffff4444-4444-4444-8444-444444444444',
  };

  /**
   * The other clinic gets its own chair, because a chair belongs to one clinic.
   * Pointing that clinic's booking at this clinic's chair would be rejected — the
   * exclusion constraints compare `chair_id` and say nothing about clinics, which
   * is the database being right about a row that should not exist.
   */
  const chairs = {
    one: 'aaaa1111-1111-4111-8111-111111111111',
    /** A second chair in the same clinic, so filtering by chair means something. */
    two: 'aaaa3333-3333-4333-8333-333333333333',
    otherClinic: 'aaaa2222-2222-4222-8222-222222222222',
  };

  /**
   * A single fixed day, in UTC, that is not "today".
   *
   * Anchoring to a literal date keeps the expectations readable and keeps the test
   * from passing or failing depending on when it runs — including across a
   * daylight-saving boundary, which a `new Date()` anchor would eventually hit.
   */
  const day = '2026-03-12';
  const at = (time: string): IsoDateTime => `${day}T${time}:00.000Z` as IsoDateTime;
  const dayStart = at('00:00');
  const wholeDay = { from: at('00:00'), to: '2026-03-13T00:00:00.000Z' as IsoDateTime };

  /**
   * The span the fixtures may touch, for both setup and teardown.
   *
   * It starts a day early on purpose: one of the fixtures begins the evening
   * before. Cleaning only the 12th left that row behind, and the next run then
   * collided with its own leftover booking — which the chair exclusion constraint
   * correctly refused. A cleanup window narrower than the fixtures is a trap that
   * only fires on the second run.
   */
  const fixtureSpan = {
    from: '2026-03-11T00:00:00.000Z' as IsoDateTime,
    to: '2026-03-14T00:00:00.000Z' as IsoDateTime,
  };
  const clearFixtures = () =>
    sql`delete from appointments where starts_at >= ${fixtureSpan.from} and starts_at < ${fixtureSpan.to}`;

  const insert = (options: {
    readonly clinic?: string;
    readonly dentist?: string | null;
    readonly chair?: string | null;
    readonly patient?: string;
    readonly startsAt: string;
    readonly durationMinutes: number;
    readonly status?: string;
  }) =>
    sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, chair_id, starts_at, duration_minutes, status)
      values (
        ${options.clinic ?? clinicId},
        ${options.patient ?? patients.ana},
        ${options.dentist === undefined ? dentists.alice : options.dentist},
        ${options.chair === undefined ? chairs.one : options.chair},
        ${options.startsAt},
        ${options.durationMinutes},
        ${options.status ?? 'SCHEDULED'}
      )
    `;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Agenda Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Agenda Other', 'UTC', 'USD')
      on conflict (id) do nothing
    `;

    await sql`
      insert into dentists (id, clinic_id, full_name)
      values
        (${dentists.alice}, ${clinicId}, 'Dr Alice'),
        (${dentists.bruno}, ${clinicId}, 'Dr Bruno')
      on conflict (id) do nothing
    `;

    await sql`
      insert into chairs (id, clinic_id, name)
      values
        (${chairs.one}, ${clinicId}, 'Chair 1'),
        (${chairs.two}, ${clinicId}, 'Chair 2'),
        (${chairs.otherClinic}, ${otherClinicId}, 'Other Chair')
      on conflict (id) do nothing
    `;

    await sql`
      insert into patients (id, clinic_id, first_name, last_name)
      values
        (${patients.ana}, ${clinicId}, 'Ana', 'Aguilar'),
        (${patients.ben}, ${clinicId}, 'Ben', 'Bustos'),
        (${patients.withdrawn}, ${clinicId}, 'Gone', 'Record'),
        (${patients.otherClinic}, ${otherClinicId}, 'Foreign', 'Patient')
      on conflict (id) do nothing
    `;

    await sql`update patients set anonymized_at = now() where id = ${patients.withdrawn}`;

    await clearFixtures();

    await insert({ startsAt: at('09:00'), durationMinutes: 30 }); // ends 09:30
    await insert({ startsAt: at('09:30'), durationMinutes: 60, dentist: dentists.bruno }); // touches the first
    await insert({ startsAt: at('12:00'), durationMinutes: 45, status: 'CANCELLED' });
    await insert({ startsAt: at('13:00'), durationMinutes: 30, status: 'NO_SHOW' });
    await insert({ startsAt: at('14:00'), durationMinutes: 30, patient: patients.ben });
    // In the clinic's other chair, at an hour nothing else uses.
    await insert({
      startsAt: at('15:00'),
      durationMinutes: 30,
      chair: chairs.two,
      dentist: dentists.bruno,
    });
    // Begun the day before, running into the window: still today's business.
    await insert({ startsAt: '2026-03-11T23:30:00.000Z', durationMinutes: 60 });
    // A dentist who has left the clinic: the booking stays, the name goes.
    await insert({ startsAt: at('16:00'), durationMinutes: 30, dentist: null });
    await insert({
      clinic: otherClinicId,
      chair: chairs.otherClinic,
      startsAt: at('10:00'),
      durationMinutes: 30,
      patient: patients.otherClinic,
      // No dentist. The fixture used to keep this clinic's dentist, which the
      // tenant foreign keys in `0002_appointment_tenant_foreign_keys` refused —
      // correctly: it is a booking in one clinic's book, for one clinic's patient,
      // in one clinic's chair, performed by another clinic's dentist. A test
      // fixture committing the exact bug the constraint exists to prevent is a
      // good sign about the constraint.
      dentist: null,
    });
    await insert({ startsAt: at('11:00'), durationMinutes: 30, patient: patients.withdrawn });
  });

  afterAll(async () => {
    await clearFixtures();
    await sql`delete from patients where id in (${patients.ana}, ${patients.ben}, ${patients.withdrawn}, ${patients.otherClinic})`;
    await sql`delete from chairs where id in (${chairs.one}, ${chairs.two}, ${chairs.otherClinic})`;
    await sql`delete from dentists where id in (${dentists.alice}, ${dentists.bruno})`;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await sql.end({ timeout: 5 });
  });

  describe('the window', () => {
    it('includes an appointment that starts before the window and runs into it', async () => {
      // The 23:30 the previous day lasts until 00:30. Filtering on `starts_at`
      // alone — which is what the dashboard used to do — would hide a patient who
      // is still in the chair at nine in the morning.
      const entries = await repository.findAgenda(clinicId, {
        from: dayStart,
        to: wholeDay.to,
      });

      expect(entries.map((entry) => entry.startsAt)).toContain('2026-03-11T23:30:00.000Z');
    });

    it('is half-open, so an appointment ending at `from` is not in the window', async () => {
      const entries = await repository.findAgenda(clinicId, {
        from: at('09:30'),
        to: wholeDay.to,
      });

      // 09:00–09:30 ends exactly at the window's start. Including it would show
      // every midnight appointment on both of the days it touches.
      expect(entries.map((entry) => entry.startsAt)).not.toContain(`${day}T09:00:00.000Z`);
    });

    it('is half-open, so an appointment starting at `to` is not in the window', async () => {
      const entries = await repository.findAgenda(clinicId, { from: dayStart, to: at('14:00') });

      expect(entries.map((entry) => entry.startsAt)).not.toContain(`${day}T14:00:00.000Z`);
    });

    it('shows back-to-back appointments side by side', async () => {
      // 09:00–09:30 and 09:30–10:00 for the same chair is a legal day: the
      // exclusion constraints use the same half-open interval.
      const entries = await repository.findAgenda(clinicId, { from: at('09:00'), to: at('11:00') });

      expect(entries).toHaveLength(2);
    });

    it('returns an empty list for a window with nothing in it', async () => {
      const entries = await repository.findAgenda(clinicId, {
        from: '2026-03-20T00:00:00.000Z' as IsoDateTime,
        to: '2026-03-21T00:00:00.000Z' as IsoDateTime,
      });

      expect(entries).toEqual([]);
    });
  });

  describe('what is on the agenda', () => {
    it("never shows another clinic's booking", async () => {
      const entries = await repository.findAgenda(clinicId, { ...wholeDay });

      expect(entries.every((entry) => entry.clinicId === clinicId)).toBe(true);
      expect(entries.map((entry) => entry.patientLastName)).not.toContain('Patient');
    });

    it('never shows a withdrawn patient', async () => {
      // The patient's row survives for traceability. Their appointment is a
      // clinical record too, and an anonymised record does not appear on a screen
      // that a receptionist reads over a patient's shoulder.
      const entries = await repository.findAgenda(clinicId, { ...wholeDay });

      expect(entries.map((entry) => entry.patientFirstName)).not.toContain('Gone');
    });

    it('includes cancelled and no-show bookings, so an empty slot looks deliberate', async () => {
      const entries = await repository.findAgenda(clinicId, { ...wholeDay });
      const statuses = entries.map((entry) => entry.status);

      // Whether a status *reserves* a slot is a scheduling question. Hiding it
      // here would make a cancelled slot look bookable.
      expect(statuses).toContain('CANCELLED');
      expect(statuses).toContain('NO_SHOW');
    });

    it('keeps an appointment whose dentist has left the clinic', async () => {
      // `dentist_id` is `on delete set null`, so this row exists with no dentist.
      // An inner join would silently drop a real booking off the book.
      const entries = await repository.findAgenda(clinicId, { ...wholeDay });
      const unassigned = entries.filter((entry) => entry.startsAt === `${day}T16:00:00.000Z`);

      expect(unassigned).toHaveLength(1);
      expect(unassigned[0]?.dentistId).toBeNull();
      expect(unassigned[0]?.dentistFullName).toBeNull();
    });

    it('names the patient and the dentist', async () => {
      const entries = await repository.findAgenda(clinicId, { from: at('09:00'), to: at('09:31') });

      expect(entries[0]).toMatchObject({
        patientFirstName: 'Ana',
        patientLastName: 'Aguilar',
        dentistId: dentists.alice,
        dentistFullName: 'Dr Alice',
        chairName: 'Chair 1',
      });
    });
  });

  describe('the shape of an entry', () => {
    it('computes the end from the start and duration', async () => {
      const entries = await repository.findAgenda(clinicId, { from: at('09:00'), to: at('09:31') });

      expect(entries[0]).toMatchObject({
        startsAt: `${day}T09:00:00.000Z`,
        endsAt: `${day}T09:30:00.000Z`,
        durationMinutes: 30,
      });
    });

    it('reports ISO strings, not Date objects', async () => {
      const entries = await repository.findAgenda(clinicId, { ...wholeDay });

      // The read model promises strings. A `Date` would serialise correctly over
      // HTTP and behave differently in every in-process caller.
      expect(typeof entries[0]?.startsAt).toBe('string');
      expect(typeof entries[0]?.endsAt).toBe('string');
    });

    it('agrees with the database about when an appointment ends', async () => {
      // The exclusion constraints compute the end in SQL. If this disagreed, the
      // agenda would offer a slot the database then refuses to book.
      const [row] = await sql`
        select appointment_ends_at(starts_at, duration_minutes) as ends_at
        from appointments
        where clinic_id = ${clinicId} and starts_at = ${at('09:00')}
      `;
      const entries = await repository.findAgenda(clinicId, { from: at('09:00'), to: at('09:31') });

      // postgres.js hands back `timestamptz` as a string, which is the same reason
      // the read model uses ISO strings: no layer silently introduces a Date.
      expect(entries[0]?.endsAt).toBe(new Date(row?.ends_at as string).toISOString());
    });

    it('orders by start, with a stable tie-breaker', async () => {
      const entries = await repository.findAgenda(clinicId, { ...wholeDay });
      const starts = entries.map((entry) => entry.startsAt);

      expect(starts).toEqual([...starts].sort());
    });
  });

  describe('filters', () => {
    it('filters by dentist', async () => {
      const entries = await repository.findAgenda(clinicId, {
        ...wholeDay,
        dentistIds: [asDentistId(dentists.bruno)],
      });

      // Bruno has two bookings and Alice has the rest, so the filter has to
      // actually exclude something.
      expect(entries.map((entry) => entry.startsAt)).toEqual([
        `${day}T09:30:00.000Z`,
        `${day}T15:00:00.000Z`,
      ]);
      expect(entries.every((entry) => entry.dentistId === dentists.bruno)).toBe(true);
    });

    it('filters by chair', async () => {
      const entries = await repository.findAgenda(clinicId, {
        ...wholeDay,
        chairIds: [asChairId(chairs.two)],
      });

      // The clinic has two chairs and bookings in both. A filter that quietly did
      // nothing would still satisfy an assertion that only checked the chair named.
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ chairId: chairs.two, chairName: 'Chair 2' });
    });

    it('ignores an empty filter rather than returning nothing', async () => {
      // `?dentistIds=` parses to an empty array. Reading that as "no dentist
      // matches" would make a cleared filter look like an empty clinic.
      const all = await repository.findAgenda(clinicId, { ...wholeDay });
      const filtered = await repository.findAgenda(clinicId, { ...wholeDay, dentistIds: [] });

      expect(filtered).toHaveLength(all.length);
    });
  });
});
