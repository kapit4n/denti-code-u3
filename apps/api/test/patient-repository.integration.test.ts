/**
 * Integration test: reading patients through `PatientRepository`.
 *
 * These methods used to be Drizzle queries written inline in the route handlers,
 * so each one had to remember the clinic filter and the withdrawn-record filter
 * for itself. The odontogram's existence check did not, and a withdrawn patient's
 * chart stayed reachable at a URL whose profile had already stopped answering.
 * That is the class of bug this file exists to prevent, and it can only be
 * prevented from outside the repository — a test that re-implemented the queries
 * would keep passing while the real ones leaked.
 *
 * It exercises the repository directly rather than through HTTP, because what is
 * being asserted is the *port's* contract — clinic scoping, the meaning of
 * `undefined`, pagination arithmetic, escaping — not the JSON envelope, which the
 * route tests already cover.
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
import { DrizzlePatientRepository } from '../src/infrastructure/persistence/repositories/patient-repository.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';
import { asClinicId, asPatientId } from '@denti-code-u3/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('PatientRepository reads (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 4 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;
  const repository = new DrizzlePatientRepository(db);

  const clinicId = asClinicId('aaaa1111-1111-4111-8111-111111111111');
  const otherClinicId = asClinicId('aaaa2222-2222-4222-8222-222222222222');

  /** Three active patients plus one withdrawn and one deactivated, deliberately. */
  const ids = {
    anna: asPatientId('bbbb1111-1111-4111-8111-111111111111'),
    bruno: asPatientId('bbbb2222-2222-4222-8222-222222222222'),
    carla: asPatientId('bbbb3333-3333-4333-8333-333333333333'),
    withdrawn: asPatientId('bbbb4444-4444-4444-8444-444444444444'),
    deactivated: asPatientId('bbbb5555-5555-4555-8555-555555555555'),
    otherClinic: asPatientId('bbbb6666-6666-4666-8666-666666666666'),
    /** No odontogram rows at all — a real patient whose teeth were never charted. */
    uncharted: asPatientId('bbbb7777-7777-4777-8777-777777777777'),
  };

  const odontogramEntryId = 'cccc1111-1111-4111-8111-111111111111';
  const withdrawnEntryId = 'cccc2222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Read Clinic', 'UTC', 'USD'),
        (${otherClinicId}, 'Read Other Clinic', 'UTC', 'USD')
      on conflict (id) do nothing
    `;

    await sql`
      delete from odontogram_entries where id in (${odontogramEntryId}, ${withdrawnEntryId})
    `;
    await sql`
      delete from patients
      where id in (
        ${ids.anna}, ${ids.bruno}, ${ids.carla}, ${ids.withdrawn},
        ${ids.deactivated}, ${ids.otherClinic}, ${ids.uncharted}
      )
    `;

    await sql`
      insert into patients (id, clinic_id, record_number, first_name, last_name, is_active)
      values
        (${ids.anna},      ${clinicId}, 'P-100001', 'Anna',   'Acevedo',   true),
        (${ids.bruno},     ${clinicId}, 'P-100002', 'Bruno',  '100% Vega', true),
        (${ids.carla},     ${clinicId}, 'P-100003', 'Carla',  'Ñuñez',     true),
        (${ids.withdrawn}, ${clinicId}, 'P-100004', 'Gone',   'Record',    true),
        (${ids.deactivated}, ${clinicId}, 'P-100005', 'Dormant', 'Patient',  false),
        (${ids.uncharted}, ${clinicId}, 'P-100006', 'No',     'Chart',     true),
        (${ids.otherClinic}, ${otherClinicId}, 'P-900001', 'Foreign', 'Patient', true)
    `;

    // Withdrawn: the row survives for traceability, so the filter has to be
    // explicit rather than relying on the row being gone.
    await sql`update patients set anonymized_at = now() where id = ${ids.withdrawn}`;

    await sql`
      insert into odontogram_entries (id, patient_id, dentition, tooth, surfaces, condition)
      values
        (${odontogramEntryId}, ${ids.anna}, 'PERMANENT', '16', '{MESIAL,OCCLUSAL}', 'FILLED'),
        (${withdrawnEntryId}, ${ids.withdrawn}, 'PERMANENT', '36', '{}', 'EXTRACTED')
    `;
  });

  afterAll(async () => {
    await sql`delete from odontogram_entries where id in (${odontogramEntryId}, ${withdrawnEntryId})`;
    await sql`
      delete from patients
      where id in (
        ${ids.anna}, ${ids.bruno}, ${ids.carla}, ${ids.withdrawn},
        ${ids.deactivated}, ${ids.otherClinic}, ${ids.uncharted}
      )
    `;
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await sql.end({ timeout: 5 });
  });

  describe('search', () => {
    it('lists only this clinic, and never a withdrawn record', async () => {
      const page = await repository.search(clinicId, { page: { offset: 0, limit: 50 } });
      const names = page.items.map((patient) => `${patient.firstName} ${patient.lastName}`);

      expect(names).toContain('Anna Acevedo');
      // The bug this file was written for: a deactivated or withdrawn record
      // appearing in a list of patients a clinician is working through.
      expect(names).not.toContain('Gone Record');
      // Another clinic's patient is invisible, not merely out of page one.
      expect(names).not.toContain('Foreign Patient');
    });

    it('counts the whole filtered set, not the page', async () => {
      // The count runs against the same predicate as the page. Counting the rows
      // in the page is how a filtered list ends up claiming several pages of one.
      const page = await repository.search(clinicId, { page: { offset: 0, limit: 2 } });

      expect(page.items).toHaveLength(2);
      expect(page.total).toBeGreaterThan(2);
    });

    it('pages without repeating or dropping a row', async () => {
      const all = await repository.search(clinicId, { page: { offset: 0, limit: 50 } });
      const firstPage = await repository.search(clinicId, { page: { offset: 0, limit: 2 } });
      const secondPage = await repository.search(clinicId, { page: { offset: 2, limit: 2 } });

      // Without an explicit ORDER BY PostgreSQL may answer two identical queries
      // differently, and a page 2 that repeats page 1 looks like data loss.
      expect(firstPage.items.map((p) => p.id)).toEqual(all.items.slice(0, 2).map((p) => p.id));
      expect(secondPage.items.map((p) => p.id)).toEqual(all.items.slice(2, 4).map((p) => p.id));
    });

    it('orders by last name then first name', async () => {
      const page = await repository.search(clinicId, { page: { offset: 0, limit: 50 } });
      const lastNames = page.items.map((patient) => patient.lastName);

      expect(lastNames).toEqual([...lastNames].sort((a, b) => a.localeCompare(b, 'es')));
    });

    it('matches the chart number', async () => {
      // A receptionist holding paperwork thinks in the number on it.
      const page = await repository.search(clinicId, {
        term: 'P-100001',
        page: { offset: 0, limit: 50 },
      });

      expect(page.items.map((patient) => patient.firstName)).toEqual(['Anna']);
    });

    it('matches case-insensitively, including outside ASCII', async () => {
      const lower = await repository.search(clinicId, {
        term: 'ñuñez',
        page: { offset: 0, limit: 50 },
      });
      const upper = await repository.search(clinicId, {
        term: 'ÑUÑEZ',
        page: { offset: 0, limit: 50 },
      });

      expect(lower.items.map((patient) => patient.firstName)).toEqual(['Carla']);
      // Folding in the query rather than relying on the collation, because the same
      // search must behave the same on a machine whose locale sorts differently.
      expect(upper.items.map((patient) => patient.firstName)).toEqual(['Carla']);
    });

    it('treats a % in the search term as text, not as a wildcard', async () => {
      // The regression this covers: `100% Vega` is findable, and searching for
      // `%` on its own returns that one patient rather than the whole clinic.
      const byPercent = await repository.search(clinicId, {
        term: '100%',
        page: { offset: 0, limit: 50 },
      });
      const bareWildcard = await repository.search(clinicId, {
        term: '%',
        page: { offset: 0, limit: 50 },
      });

      expect(byPercent.items.map((patient) => patient.lastName)).toEqual(['100% Vega']);
      // Unescaped, `LIKE '%%%'` matches every row in the clinic.
      expect(bareWildcard.items).toHaveLength(1);
    });

    it('treats _ as text too', async () => {
      const page = await repository.search(clinicId, { term: '_', page: { offset: 0, limit: 50 } });

      expect(page).toMatchObject({ total: 0, items: [] });
    });

    it('ignores a blank search term rather than matching nothing', async () => {
      const blank = await repository.search(clinicId, {
        term: '   ',
        page: { offset: 0, limit: 50 },
      });
      const absent = await repository.search(clinicId, { page: { offset: 0, limit: 50 } });

      // A whitespace-only box is not a search for a space.
      expect(blank.total).toBe(absent.total);
    });

    it('includes deactivated patients by default', async () => {
      // Hiding them would make a record impossible to find and reactivate, which
      // is the opposite of what deactivating is for.
      const page = await repository.search(clinicId, { page: { offset: 0, limit: 50 } });

      expect(page.items.map((patient) => patient.firstName)).toContain('Dormant');
    });

    it('excludes deactivated patients when asked', async () => {
      const page = await repository.search(clinicId, {
        onlyActive: true,
        page: { offset: 0, limit: 50 },
      });

      expect(page.items.map((patient) => patient.firstName)).not.toContain('Dormant');
      expect(page.items.length).toBeGreaterThan(0);
    });

    it('reports timestamps as ISO strings, not Date objects', async () => {
      const page = await repository.search(clinicId, { page: { offset: 0, limit: 1 } });

      // The read model promises `IsoDateTime`. Relying on JSON serialisation to
      // turn a `Date` into one would leave every in-memory caller handling a
      // different shape from every HTTP caller.
      expect(typeof page.items[0]?.createdAt).toBe('string');
      expect(page.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('findProfile', () => {
    it('returns the patient with their clinical context', async () => {
      const profile = await repository.findProfile(clinicId, ids.anna);

      expect(profile).toMatchObject({
        id: ids.anna,
        clinicId,
        recordNumber: 'P-100001',
        firstName: 'Anna',
        allergies: null,
        upcomingAppointment: null,
        recentVisits: [],
        outstandingTreatments: [],
      });
      // Nulls, not absent keys: a missing key reads as "the API forgot".
      expect(profile).toHaveProperty('phone', null);
      expect(profile).toHaveProperty('financialBalance');
      expect(profile?.financialBalance).toMatchObject({ outstandingMinor: 0, chargeCount: 0 });
    });

    it('returns undefined for another clinic, indistinguishable from missing', async () => {
      const other = await repository.findProfile(clinicId, ids.otherClinic);
      const missing = await repository.findProfile(
        clinicId,
        asPatientId('ffff9999-9999-4999-8999-999999999999'),
      );

      // Both undefined, so a caller cannot use this to learn that an id exists in
      // a clinic it cannot reach (ADR 0014).
      expect(other).toBeUndefined();
      expect(missing).toBeUndefined();
    });

    it('returns undefined for a withdrawn record', async () => {
      // The same rule the write side applies. If read and write disagreed, an edit
      // would report success against a profile that answers 404.
      expect(await repository.findProfile(clinicId, ids.withdrawn)).toBeUndefined();
    });

    it('never returns anonymizedAt, even as null', async () => {
      const profile = await repository.findProfile(clinicId, ids.anna);

      // The row used to be spread into the response, so this column was published
      // on every profile load. Naming the fields is what keeps it out.
      expect(profile).not.toHaveProperty('anonymizedAt');
    });
  });

  describe('findOdontogram', () => {
    it('returns the chart for a patient', async () => {
      const chart = await repository.findOdontogram(clinicId, ids.anna);

      expect(chart?.entries).toHaveLength(1);
      expect(chart?.entries[0]).toMatchObject({ dentition: 'PERMANENT', tooth: '16' });
      expect(typeof chart?.entries[0]?.recordedAt).toBe('string');
    });

    it('distinguishes an uncharted patient from a missing one', async () => {
      // A real patient with nothing charted must not be a 404: the difference is
      // "start charting" versus "this is not your patient".
      const uncharted = await repository.findOdontogram(clinicId, ids.uncharted);

      expect(uncharted).toEqual({ entries: [] });
    });

    it('does not serve the chart of a withdrawn record', async () => {
      // The bug this refactor fixed. The existence check written in the route
      // handler omitted `anonymized_at is null`, so this returned the entries of a
      // patient whose profile had already stopped answering — tooth-level clinical
      // history reachable for a record the product has withdrawn.
      expect(await repository.findOdontogram(clinicId, ids.withdrawn)).toBeUndefined();
    });

    it("does not serve another clinic's chart", async () => {
      expect(await repository.findOdontogram(clinicId, ids.otherClinic)).toBeUndefined();
    });
  });
});
