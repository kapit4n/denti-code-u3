/**
 * Integration test: the appointment overlap guard.
 *
 * This is the only place the scheduling invariant is proven against a real
 * PostgreSQL, because the guarantee comes from an exclusion constraint — a
 * database feature that cannot be simulated by a unit test. Run it with:
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

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('appointments: overlap guard (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(sql, { casing: 'snake_case' });

  const clinicId = '11111111-1111-4111-8111-111111111111';
  const dentistId = '22222222-2222-4222-8222-222222222222';
  const patientId = '33333333-3333-4333-8333-333333333333';

  const insertAppointment = (startsAt: string, durationMinutes: number, status = 'SCHEDULED') =>
    sql`
      insert into appointments
        (clinic_id, patient_id, dentist_id, starts_at, duration_minutes, status)
      values
        (${clinicId}, ${patientId}, ${dentistId}, ${startsAt}, ${durationMinutes}, ${status})
      returning id, starts_at, duration_minutes, status
    `;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    await sql`insert into clinics (id, name) values (${clinicId}, 'Guard Test') on conflict do nothing`;
    await sql`insert into dentists (id, clinic_id, full_name) values (${dentistId}, ${clinicId}, 'Dr Test') on conflict do nothing`;
    await sql`insert into patients (id, clinic_id, first_name, last_name) values (${patientId}, ${clinicId}, 'Test', 'Patient') on conflict do nothing`;
    await sql`delete from appointments where clinic_id = ${clinicId}`;
  });

  afterAll(async () => {
    await sql`delete from appointments where clinic_id = ${clinicId}`;
    await sql`delete from dentists where id = ${dentistId}`;
    await sql`delete from patients where id = ${patientId}`;
    await sql`delete from clinics where id = ${clinicId}`;
    await sql.end({ timeout: 5 });
  });

  it('derives the end of an appointment from the start and duration, without storing it', async () => {
    await insertAppointment('2026-03-02 09:00:00+00', 30);

    const [row] = await sql`
      select appointment_ends_at(starts_at, duration_minutes) as ends_at,
             starts_at,
             duration_minutes
      from appointments
      where clinic_id = ${clinicId}
      order by starts_at
      limit 1
    `;

    // postgres.js hands back timestamptz as a string unless the connection
    // declares a custom type parser, so the assertion normalises both forms.
    const endsAt = new Date(row!.ends_at as string);
    const startsAt = new Date(row!.starts_at as string);

    expect(endsAt.toISOString()).toBe('2026-03-02T09:30:00.000Z');
    expect(endsAt.getTime() - startsAt.getTime()).toBe(row!.duration_minutes * 60 * 1000);
  });

  it('re-evaluates the range when an appointment is rescheduled', async () => {
    // The guard reads the row's own columns, so moving an appointment has to be
    // able to create a collision. Comparing against a value frozen at insert
    // time would let this update through, which is the bug this asserts against.
    const [morning] = await insertAppointment('2026-03-04 09:00:00+00', 30);
    await insertAppointment('2026-03-04 11:00:00+00', 30);

    // 11:15-11:45 now overlaps the 11:00-11:30 booked a moment ago.
    await expect(
      sql`update appointments set starts_at = '2026-03-04 11:15:00+00' where id = ${morning!.id}`,
    ).rejects.toThrow(/appointments_dentist_no_overlap/);

    // The rejected update must not have moved the row.
    const [after] = await sql`select starts_at from appointments where id = ${morning!.id}`;
    expect(new Date(after!.starts_at as string).toISOString()).toBe('2026-03-04T09:00:00.000Z');
  });

  it('rejects a second appointment that overlaps the same dentist', async () => {
    // 09:15-09:45 sits inside the 09:00-09:30 booked by the previous test.
    await expect(insertAppointment('2026-03-02 09:15:00+00', 30)).rejects.toThrow(
      /appointments_dentist_no_overlap/,
    );
  });

  it('allows a back-to-back appointment (half-open range)', async () => {
    await expect(insertAppointment('2026-03-02 09:30:00+00', 30)).resolves.toHaveLength(1);
  });

  it('frees the slot once the conflicting appointment is cancelled', async () => {
    await sql`update appointments set status = 'CANCELLED' where clinic_id = ${clinicId} and starts_at = '2026-03-02 09:00:00+00'`;

    await expect(insertAppointment('2026-03-02 09:00:00+00', 30)).resolves.toHaveLength(1);
  });
});
