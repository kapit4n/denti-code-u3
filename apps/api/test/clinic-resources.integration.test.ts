/**
 * Integration test: `GET /api/v1/dentists` and `GET /api/v1/chairs`.
 *
 * These two lists exist because an appointment booking names a `dentistId` and
 * accepts a `chairId`, and until now nothing could tell a client what those names
 * were. That makes four properties worth pinning, and three of the four are silent
 * when they break:
 *
 *  - **Ordering.** The database runs `--locale=C`, which sorts by byte value, so
 *    `Ñuñez` sorts after `Vargas` and every accented clinician sinks to the bottom of
 *    a dropdown. Asserting the order is therefore asserting the folding, not the
 *    `ORDER BY`.
 *  - **`roomName` comes from the join, not from a uuid.** A chair with no room is
 *    still listed, with `roomName: null` — an inner join would hide it.
 *  - **`onlyActive` defaults to *no filter*.** A clinician who has left still appears
 *    on the appointments they worked; hiding the row leaves those naming nobody.
 *  - **Clinic scope**, the same rule as every other read.
 *
 * The real routes are exercised through Fastify's `inject` against real PostgreSQL,
 * because all four failures above are SQL-level. It uses `TEST_DATABASE_URL`, so it
 * can never touch development data.
 *
 * Run it with:
 *
 *   pnpm run db:up
 *   pnpm run test:integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { registerChairsRoutes } from '../src/http/routes/chairs.js';
import { registerDentistsRoutes } from '../src/http/routes/dentists.js';
import { DrizzleChairRepository } from '../src/infrastructure/persistence/repositories/chair-repository.js';
import { DrizzleDentistRepository } from '../src/infrastructure/persistence/repositories/dentist-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';
import { asClinicId, asDentistId, type DentistId } from '@denti-code-u3/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('dentists and chairs (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = 'd1d1d1d1-0000-4000-8000-000000000001';
  const otherClinicId = 'd1d1d1d1-0000-4000-8000-000000000002';

  const dentistIds = {
    nunez: 'd1d1d1d1-1111-4000-8000-000000000001',
    retired: 'd1d1d1d1-1111-4000-8000-000000000002',
    otherClinic: 'd1d1d1d1-1111-4000-8000-000000000003',
  } as const;

  const chairIds = {
    sillon1: 'd1d1d1d1-2222-4000-8000-000000000001',
    sillonNoRoom: 'd1d1d1d1-2222-4000-8000-000000000002',
    maintenance: 'd1d1d1d1-2222-4000-8000-000000000003',
    otherClinic: 'd1d1d1d1-2222-4000-8000-000000000004',
  } as const;

  const roomId = 'd1d1d1d1-3333-4000-8000-000000000001';
  const otherRoomId = 'd1d1d1d1-3333-4000-8000-000000000002';

  let app: FastifyInstance;
  let scopedClinicId = clinicId;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { clinicId: string }).clinicId = scopedClinicId;
    });
    await registerDentistsRoutes(app, { dentists: new DrizzleDentistRepository(db) });
    await registerChairsRoutes(app, { chairs: new DrizzleChairRepository(db) });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Resources Test', 'America/Lima', 'PEN'),
        (${otherClinicId}, 'Other Resources Clinic', 'America/Lima', 'PEN')
      on conflict (id) do nothing
    `;

    await sql`
      insert into rooms (id, clinic_id, name)
      values
        (${roomId}, ${clinicId}, 'Aula 1'),
        (${otherRoomId}, ${otherClinicId}, 'AulaAjena')
      on conflict (id) do nothing
    `;

    // `Álvaro` before `Beatriz`, which is only true if the `Á` is folded: as UTF-8
    // `Á` is 0xC3 0x81, so byte order puts it *after* `Beatriz` — and under the
    // database's `C` collation that is exactly what would happen. The names carry no
    // shared `Dr.`/`Dra.` prefix on purpose: a common prefix decides the comparison
    // before the accent is reached, and an ordering test that passes either way
    // proves nothing.
    await sql`
      insert into dentists (id, clinic_id, user_id, full_name, speciality, color, is_active)
      values
        (${dentistIds.nunez}, ${clinicId}, null, 'Beatriz Ñaupari', 'Endodoncia', '#0ea5e9', true),
        (${dentistIds.retired}, ${clinicId}, null, 'Álvaro Núñez', null, null, false),
        (${dentistIds.otherClinic}, ${otherClinicId}, null, 'Dr. Otro', 'Cirugía', null, true)
      on conflict (id) do nothing
    `;

    await sql`
      insert into chairs (id, clinic_id, room_id, name, is_active)
      values
        (${chairIds.sillon1}, ${clinicId}, ${roomId}, 'Sillón 2', true),
        (${chairIds.sillonNoRoom}, ${clinicId}, null, 'Sillón 1', true),
        (${chairIds.maintenance}, ${clinicId}, ${roomId}, 'Sillón 3', false),
        (${chairIds.otherClinic}, ${otherClinicId}, null, 'Sillón Ajeno', true)
      on conflict (id) do nothing
    `;
  });

  afterAll(async () => {
    await sql`delete from chairs where id in ${sql(chairIds)}`;
    await sql`delete from dentists where id in ${sql(dentistIds)}`;
    await sql`delete from rooms where id in (${roomId}, ${otherRoomId})`;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  describe('GET /api/v1/dentists', () => {
    it('lists the clinic’s own clinicians, folded by name', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/dentists' });

      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((item: { fullName: string }) => item.fullName)).toEqual([
        'Álvaro Núñez',
        'Beatriz Ñaupari',
      ]);
    });

    it('answers with nulls rather than invented values', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/dentists' });

      const byId = new Map<string, Record<string, unknown>>(
        response.json().items.map((item: Record<string, unknown>) => [item.id, item]),
      );

      // No login, no speciality and no colour are three separate nulls, not three
      // empty strings: `''` would render as a blank line where nothing is unknown,
      // and would be accepted where a value is required.
      expect(byId.get(dentistIds.retired)).toMatchObject({
        userId: null,
        speciality: null,
        color: null,
        isActive: false,
      });
      expect(byId.get(dentistIds.nunez)).toMatchObject({
        speciality: 'Endodoncia',
        color: '#0ea5e9',
        isActive: true,
      });
    });

    it('lists a clinician who has left unless asked otherwise', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/dentists?onlyActive=true' });

      // The filter is opt-in. A deactivated clinician still appears on the
      // appointments they worked, so the default list has to contain them.
      expect(response.json().items.map((item: { fullName: string }) => item.fullName)).toEqual([
        'Beatriz Ñaupari',
      ]);
    });

    it('never answers with another clinic’s clinician', async () => {
      scopedClinicId = otherClinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/dentists' });

      expect(response.json().items.map((item: { fullName: string }) => item.fullName)).toEqual([
        'Dr. Otro',
      ]);
    });

    it('refuses a filter flag it cannot read', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/dentists?onlyActive=yes' });

      // Treating `yes` as `false` would return everything the caller believed it had
      // excluded — the quietest possible wrong answer.
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('finds a clinician by id, in their own clinic only', async () => {
      const repository = new DrizzleDentistRepository(db);

      const found = await repository.findById(
        asClinicId(clinicId),
        asDentistId(dentistIds.nunez) as DentistId,
      );
      expect(found?.fullName).toBe('Beatriz Ñaupari');

      // Another clinic's id is *not found*, not refused: saying it exists elsewhere
      // is itself a disclosure.
      const across = await repository.findById(
        asClinicId(clinicId),
        asDentistId(dentistIds.otherClinic) as DentistId,
      );
      expect(across).toBeUndefined();
    });
  });

  describe('GET /api/v1/chairs', () => {
    it('names the room rather than offering its id', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/chairs' });

      expect(response.statusCode).toBe(200);
      const byId = new Map<string, Record<string, unknown>>(
        response.json().items.map((item: Record<string, unknown>) => [item.id, item]),
      );

      expect(byId.get(chairIds.sillon1)).toMatchObject({
        name: 'Sillón 2',
        roomId,
        roomName: 'Aula 1',
        isActive: true,
      });
    });

    it('lists a chair with no room instead of dropping it', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/chairs' });

      const ids = response.json().items.map((item: { id: string }) => item.id);

      // The join has to be a LEFT JOIN: `chairs.room_id` is nullable, and an inner
      // join would hide every unassigned chair from the list of bookable chairs.
      expect(ids).toContain(chairIds.sillonNoRoom);
      const orphaned = response
        .json()
        .items.find((item: { id: string }) => item.id === chairIds.sillonNoRoom);
      expect(orphaned).toMatchObject({ roomId: null, roomName: null });
    });

    it('sorts by folded chair name', async () => {
      scopedClinicId = clinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/chairs' });

      expect(response.json().items.map((item: { name: string }) => item.name)).toEqual([
        'Sillón 1',
        'Sillón 2',
        'Sillón 3',
      ]);
    });

    it('filters out the chairs under maintenance only when asked', async () => {
      scopedClinicId = clinicId;

      const all = await app.inject({ method: 'GET', url: '/api/v1/chairs' });
      expect(all.json().items.map((item: { id: string }) => item.id)).toContain(
        chairIds.maintenance,
      );

      const active = await app.inject({ method: 'GET', url: '/api/v1/chairs?onlyActive=true' });
      expect(active.json().items.map((item: { id: string }) => item.id)).not.toContain(
        chairIds.maintenance,
      );
    });

    it('never answers with another clinic’s chairs', async () => {
      scopedClinicId = otherClinicId;
      const response = await app.inject({ method: 'GET', url: '/api/v1/chairs' });

      expect(response.json().items.map((item: { name: string }) => item.name)).toEqual([
        'Sillón Ajeno',
      ]);
    });
  });

  describe('a clinic with no clinicians and no chairs', () => {
    const emptyClinicId = 'd1d1d1d1-0000-4000-8000-0000000000ee';

    beforeAll(async () => {
      await sql`
        insert into clinics (id, name, time_zone, currency_code)
        values (${emptyClinicId}, 'Empty Clinic', 'America/Lima', 'PEN')
        on conflict (id) do nothing
      `;
    });

    afterAll(async () => {
      await sql`delete from clinics where id = ${emptyClinicId}`;
    });

    it('answers with empty lists, not an error', async () => {
      scopedClinicId = emptyClinicId;

      // A clinic being set up has no dentists yet, and that is a normal state, not a
      // fault. 404 would send the booking form looking for a broken endpoint.
      const dentists = await app.inject({ method: 'GET', url: '/api/v1/dentists' });
      const chairs = await app.inject({ method: 'GET', url: '/api/v1/chairs' });

      expect(dentists.statusCode).toBe(200);
      expect(dentists.json()).toEqual({ items: [] });
      expect(chairs.statusCode).toBe(200);
      expect(chairs.json()).toEqual({ items: [] });
    });
  });
});
