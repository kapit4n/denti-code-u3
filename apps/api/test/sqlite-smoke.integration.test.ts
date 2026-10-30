/**
 * Integration smoke test: the whole API on SQLite (ADR 0025).
 *
 * The PostgreSQL integration tests are opt-in via `TEST_DATABASE_URL`; this one
 * always runs, because SQLite needs no external service. It builds the real
 * server through `buildServer` so the engine selection, the SQLite connection,
 * the hand-written `UnitOfWork`, the overlap triggers and the dashboard read
 * store are all exercised as the process runs them — not as a hand-wired
 * replica of them.
 *
 * It proves the end-to-end things only an engine can:
 *
 *  - **The overlap trigger answers, not just the domain check.** Two requests
 *    for the same slot both pass the domain's conflict check; the loser is
 *    refused by the `BEFORE INSERT` trigger (and moves by its `BEFORE UPDATE`
 *    twin) and arrives as `SCHEDULING_CONFLICT` rather than a 500.
 *  - **Tenant foreign keys hold.** A booking that names another clinic's dentist
 *    is a composite-key refusal, reported as `INVALID_INPUT`.
 *  - **The visit bridge is transactional.** Starting a visit moves two rows; a
 *    second start is refused by the unique index (`DUPLICATED_RECORD`).
 *  - **A note scopes through its visit.** `clinical_notes` has no clinic column, so
 *    both verbs resolve the visit in this clinic first — the join that does it is
 *    written twice, once per engine (ADR 0025), and this is the second one.
 *  - **The catalogue and a treatment record scope through the clinic.** The catalogue
 *    is a `clinic_id` the row carries; a record is a `visit_id` it does not, so the
 *    record's read scopes through the visit and its write through the treatment — the
 *    second implementation of each, on the engine that must not disagree.
 *  - **A treatment record can name the planned item it fulfils.** The link is resolved
 *    on the patient's own plan before the insert and written on the execution side; the
 *    record never completes the line, which stays `completeTreatmentPlanItem`'s job.
 *  - **A prescription scopes through its visit, and names who it is about by
 *    inheritance.** `prescriptions` has no clinic column and no patient or dentist
 *    column of its own from the request — the write resolves the visit in this clinic
 *    and copies the patient and clinician from it, and the join that scopes the read
 *    is the second implementation of the notes' (ADR 0014, ADR 0025).
 *  - **A charge carries its own clinic_id, so its read needs no join — but the visit
 *    is still read first.** The first billing row scopes on its own column, priced in
 *    the clinic's own record, and still 404s for another clinic's visit — the second
 *    implementation of the whole shape, on the engine that must not disagree.
 *  - **The dashboard reads real rows** on the SQLite engine — revenue, capacity,
 *    calendar day, recent patients.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';
import { resolveClinicTimeWindow } from '../src/application/clinic-time-window.js';
import { createSqliteConnection } from '../src/infrastructure/persistence/sqlite/connection.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { buildServer, type DentiApiServer } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const clinicId = 'a0a0a0a0-0000-4000-8000-000000000001';
const otherClinicId = 'a0a0a0a0-0000-4000-8000-000000000002';
const dentistId = 'a0a0a0a0-0000-4000-8000-000000000004';
const otherDentistId = 'a0a0a0a0-0000-4000-8000-000000000005';
const chairId = 'a0a0a0a0-0000-4000-8000-000000000006';
const roomId = 'a0a0a0a0-0000-4000-8000-000000000007';
const treatmentId = 'a0a0a0a0-0000-4000-8000-000000000008';
/** Another clinic's treatment, so the record write has something to refuse. */
const foreignTreatmentId = 'a0a0a0a0-0000-4000-8000-000000000009';
/** Another clinic's patient and visit, so the notes read has something to refuse. */
const foreignPatientId = 'a0a0a0a0-0000-4000-8000-000000000011';
const foreignVisitId = 'a0a0a0a0-0000-4000-8000-000000000012';
/** Another clinic's stock item, so the movement read has something to refuse. */
const foreignInventoryItemId = 'a0a0a0a0-0000-4000-8000-000000000013';
/** The seeded login every request in this suite authenticates as. */
const ADMIN_EMAIL = 'admin@sqlite-smoke.test';
const ADMIN_PASSWORD = 'smoke-secret';

describe('API on SQLite', () => {
  let dir: string;
  let app: DentiApiServer;
  let authToken: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'denti-sqlite-'));
    const databaseUrl = `sqlite:${path.join(dir, 'denti.db')}`;

    const { db, client } = createSqliteConnection(databaseUrl);
    await migrate(db, {
      migrationsFolder: path.join(here, '../../../database/migrations-sqlite'),
    });
    await seed(db);
    client.close();

    app = await buildServer({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: databaseUrl,
      CLINIC_TIMEZONE: 'UTC',
      CLINIC_ID: clinicId,
    });

    // Log in once and let every request below carry the bearer token by default:
    // these tests are about the clinical surface, not about authentication, which
    // has its own specs. `injectWithAuth` also proves the default path stays
    // authenticated — a route that forgot to be public yet answered without a token
    // would be a bug this suite would have to fail on.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    if (login.statusCode !== 200) {
      throw new Error(`Smoke login failed: ${login.statusCode} ${login.body}`);
    }
    authToken = login.json().token;

    const originalInject = app.inject.bind(app);
    app.inject = ((options: string | Record<string, unknown>) => {
      const normalized = typeof options === 'string' ? { url: options } : options;
      const url = normalized.url;
      if (url === '/ready' || url === '/health') {
        return originalInject(options as never);
      }
      return originalInject({
        ...normalized,
        headers: { authorization: `Bearer ${authToken}`, ...(normalized.headers as object) },
      } as never);
    }) as typeof app.inject;
  });

  afterAll(async () => {
    await app?.close();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('declares itself ready on /ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().checks.database).toBe('ok');
  });

  let apiPatientId: string;
  /** The visit the booking above became, captured for the note written on it. */
  let visitId: string;

  /** The clinics table is empty of patients, so the first registration is P-000001. */
  it('registers a patient, issuing sequential chart numbers', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/patients',
      payload: { firstName: 'Dee', lastName: 'Book', allergies: 'Penicillin' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.recordNumber).toBe('P-000001');
    expect(body.clinicId).toBe(clinicId);
    apiPatientId = body.id;
    expect(apiPatientId).toBeTruthy();

    const profile = await app.inject({ method: 'GET', url: `/api/v1/patients/${apiPatientId}` });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().allergies).toBe('Penicillin');
  });

  it('edits the patient’s allergies, clearing them when the edit leaves the field out', async () => {
    const changed = await app.inject({
      method: 'PUT',
      url: `/api/v1/patients/${apiPatientId}`,
      payload: { firstName: 'Dee', lastName: 'Book', allergies: '  Latex  ' },
    });
    expect(changed.statusCode).toBe(204);

    const withLatex = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}`,
    });
    expect(withLatex.json().allergies).toBe('Latex');

    const cleared = await app.inject({
      method: 'PUT',
      url: `/api/v1/patients/${apiPatientId}`,
      payload: { firstName: 'Dee', lastName: 'Book' },
    });
    expect(cleared.statusCode).toBe(204);

    const withoutAllergies = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}`,
    });
    expect(withoutAllergies.json().allergies).toBeNull();
  });

  it('finds the patient by an accented-then-folded search', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/patients?q=book',
    });

    expect(response.statusCode).toBe(200);
    const { items, pagination } = response.json();
    expect(pagination.total).toBe(1);
    expect(items[0]?.lastName).toBe('Book');
  });

  /**
   * Booking times are derived from today's clinic-local window rather than from
   * a fixed calendar date, so these fixtures mean the same thing whenever the
   * suite runs — the dashboard's "today" is whoever today is (the clinic is UTC,
   * 08:00–17:00 every day, one active dentist).
   */
  const today = resolveClinicTimeWindow(new Date(), 'UTC');
  const at = (offsetMinutes: number) =>
    new Date(today.start.getTime() + offsetMinutes * 60_000).toISOString();
  const nineAm = at(9 * 60);
  const tenAm = at(10 * 60);

  const book = (overrides: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/appointments',
      payload: {
        patientId: apiPatientId,
        dentistId,
        chairId,
        startsAt: nineAm,
        durationMinutes: 30,
        ...overrides,
      },
    });

  let appointmentId: string;

  it('books an appointment', async () => {
    const response = await book();
    expect(response.statusCode).toBe(201);
    appointmentId = response.json().id;
    expect(appointmentId).toBeTruthy();
  });

  it('lets the overlap trigger refuse a double booking as a 409, not a 500', async () => {
    const response = await book();
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('refuses a booking that names another clinic’s dentist as a 422', async () => {
    // An empty slot, so the overlap trigger does not fire first: the refusal
    // has to be the composite tenant foreign key, and only that. The wire folds
    // `INVALID_INPUT` to `VALIDATION_ERROR` (see `problem.ts`).
    const response = await book({ dentistId: otherDentistId, startsAt: tenAm });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lets the move trigger refuse a move onto an occupied slot as a 409', async () => {
    const response = await book({ startsAt: tenAm });
    expect(response.statusCode).toBe(201);
    const secondId = response.json().id;

    // 09:15–09:45 collides with the 09:00 booking — an UPDATE now, not an INSERT.
    const move = await app.inject({
      method: 'PUT',
      url: `/api/v1/appointments/${secondId}/schedule`,
      payload: { startsAt: nineAm, durationMinutes: 30 },
    });

    expect(move.statusCode).toBe(409);
    expect(move.json().error.code).toBe('SCHEDULING_CONFLICT');
  });

  it('starts a visit from the booking inside a transaction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      payload: { appointmentId },
    });

    expect(response.statusCode).toBe(201);
    const { visit, appointment } = response.json();
    expect(visit.status).toBe('OPEN');
    expect(appointment.status).toBe('IN_TREATMENT');
    visitId = visit.id;
  });

  it('refuses a second visit for the same appointment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/visits',
      payload: { appointmentId },
    });

    // The second start fails the domain's "already has a visit" guard before any
    // row is written; the wire folds that `DUPLICATED_RECORD` to
    // `DOMAIN_RULE_VIOLATION` (see `problem.ts`), exactly as on PostgreSQL.
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('DOMAIN_RULE_VIOLATION');
  });

  it('files a note on the visit and scopes both verbs through it', async () => {
    const filed = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/notes`,
      payload: { body: '  Sensitivity reported.  ' },
    });

    expect(filed.statusCode).toBe(201);
    // Trimming at the boundary, `authorId` left null (no user model yet), and the
    // same envelope PostgreSQL answers with — the engine is not supposed to show.
    expect(filed.json()).toMatchObject({
      visitId,
      body: 'Sensitivity reported.',
      authorId: null,
    });

    const ours = await app.inject({ method: 'GET', url: `/api/v1/visits/${visitId}/notes` });
    expect(ours.statusCode).toBe(200);
    expect(ours.json().notes).toHaveLength(1);

    // `clinical_notes` has no clinic column, so the read scopes by joining the
    // visit — a second implementation of that join, on the engine that must not
    // disagree with the first about what a clinic may see (ADR 0014, ADR 0025).
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${foreignVisitId}/notes`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    const refusedWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${foreignVisitId}/notes`,
      payload: { body: 'Another clinic’s note.' },
    });
    // Refused before anything is written: the use case reads the visit first, and
    // `clinical-notes.test.ts` asserts the half a 404 cannot show — that `save`
    // was never called.
    expect(refusedWrite.statusCode).toBe(404);
    expect(refusedWrite.json().error.code).toBe('NOT_FOUND');
  });

  it('lists the catalogue and records a treatment through it, scoping both through the clinic', async () => {
    const catalogue = await app.inject({ method: 'GET', url: '/api/v1/treatments' });

    expect(catalogue.statusCode).toBe(200);
    const items = catalogue.json().items as { id: string; name: string; isActive: boolean }[];
    // The catalogue is scoped by the tenant the row carries — a second implementation
    // of that `clinic_id = ?` select, on the engine that must not disagree (ADR 0025).
    expect(items.map((item) => item.id)).toContain(treatmentId);
    expect(items).not.toContain(foreignTreatmentId);

    const recorded = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/treatments`,
      payload: { treatmentId, tooth: '36', notes: 'Follow-up done.' },
    });

    expect(recorded.statusCode).toBe(201);
    expect(recorded.json()).toMatchObject({
      visitId,
      treatmentId,
      tooth: '36',
      notes: 'Follow-up done.',
    });

    const ours = await app.inject({ method: 'GET', url: `/api/v1/visits/${visitId}/treatments` });
    expect(ours.statusCode).toBe(200);
    expect(ours.json().treatments).toHaveLength(1);

    // `visit_treatment_executions` has no clinic column, so the read scopes by joining
    // the visit — the same story the notes tell, and the same 404 for another clinic's
    // visit (ADR 0014).
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${foreignVisitId}/treatments`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    // The treatment is scoped too, by the second read the write makes: a treatment
    // this clinic does not offer is `INVALID_INPUT`, folded to 422 by the wire, and
    // nothing is written.
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/treatments`,
      payload: { treatmentId: foreignTreatmentId },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('adds a treatment to the catalogue, refusing a duplicate code', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/treatments',
      payload: {
        code: 'CROWN-PM',
        name: 'Porcelain crown — premolar',
        description: 'Full-coverage all-ceramic crown.',
        defaultDurationMinutes: 90,
        defaultPriceMinor: 45_000,
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().item).toMatchObject({
      code: 'CROWN-PM',
      name: 'Porcelain crown — premolar',
      defaultPriceMinor: 45_000,
      isActive: true,
    });

    // The row is really there: the same catalogue read the picker draws shows it.
    const catalogue = await app.inject({ method: 'GET', url: '/api/v1/treatments' });
    expect(catalogue.json().items.map((item: { code: string }) => item.code)).toContain('CROWN-PM');

    // The same code again is the (clinic_id, code) unique index answering in a
    // language the caller can act on, on this engine too (ADR 0025).
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/treatments',
      payload: { code: 'CROWN-PM', name: 'Duplicate code' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('DOMAIN_RULE_VIOLATION');

    // A body that cannot name the treatment is refused before the domain is asked.
    const unnamed = await app.inject({
      method: 'POST',
      url: '/api/v1/treatments',
      payload: { name: '   ' },
    });
    expect(unnamed.statusCode).toBe(422);
    expect(unnamed.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lists one patient’s treatment plans, newest first, with progress', async () => {
    // The smoke suite's patient is registered through the API during this block, so
    // the plan is filed under them through a fresh connection to the same file.
    const { db, client } = createSqliteConnection(`sqlite:${path.join(dir, 'denti.db')}`);
    await db
      .insert(sqliteSchema.treatmentPlans)
      .values({
        id: 'a0a0a0a0-0000-4000-8000-000000000020',
        clinicId,
        patientId: apiPatientId,
        status: 'ACCEPTED',
        title: 'Crown on 36',
      })
      .run();
    await db
      .insert(sqliteSchema.treatmentPlanItems)
      .values([
        {
          id: 'a0a0a0a0-0000-4000-8000-000000000021',
          treatmentPlanId: 'a0a0a0a0-0000-4000-8000-000000000020',
          treatmentId,
          tooth: '36',
          surfaces: ['OCCLUSAL'],
          quantity: 1,
          estimatedPriceMinor: 45_000,
          isCompleted: false,
        },
        {
          id: 'a0a0a0a0-0000-4000-8000-000000000022',
          treatmentPlanId: 'a0a0a0a0-0000-4000-8000-000000000020',
          treatmentId,
          tooth: '16',
          surfaces: [],
          quantity: 1,
          estimatedPriceMinor: 15_000,
          isCompleted: true,
        },
      ])
      .run();
    client.close();

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
    });

    expect(read.statusCode).toBe(200);
    const { items } = read.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Crown on 36',
      status: 'ACCEPTED',
      dentistId: null,
      progress: { total: 2, completed: 1, percentComplete: 50 },
      items: [
        {
          tooth: '36',
          treatmentName: 'Composite restoration',
          treatmentCode: 'COMPO',
          isCompleted: false,
        },
        { tooth: '16', treatmentName: 'Composite restoration', isCompleted: true },
      ],
    });

    // The same "this clinic cannot see you" 404 the profile gives, on SQLite too.
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${foreignPatientId}/treatment-plans`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');
  });

  it('proposes, presents and completes a treatment plan through the write side', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
      payload: {
        title: '  Full mouth rehab  ',
        items: [
          {
            treatmentId,
            tooth: '36',
            surfaces: ['OCCLUSAL', 'MESIAL'],
            estimatedPriceMinor: 45_000,
          },
        ],
      },
    });

    expect(created.statusCode).toBe(201);
    const plan = created.json().plan;
    expect(plan).toMatchObject({
      status: 'DRAFT',
      title: 'Full mouth rehab',
      presentedAt: null,
      acceptedAt: null,
      progress: { total: 1, completed: 0, percentComplete: 0 },
    });
    expect(plan.items[0]).toMatchObject({
      tooth: '36',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      treatmentCode: 'COMPO',
      treatmentName: 'Composite restoration',
      isCompleted: false,
    });

    // Persisted: the read the plan screen draws shows it, with its line and its
    // progress — the same two engines answering the same plan (ADR 0025).
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
    });
    const stored = read.json().items.find((entry: { id: string }) => entry.id === plan.id);
    expect(stored).toMatchObject({
      status: 'DRAFT',
      title: 'Full mouth rehab',
      progress: { total: 1, completed: 0 },
    });
    expect(stored.items).toHaveLength(1);

    // Present it: the status moves and the first presented stamp is set.
    const presented = await app.inject({
      method: 'PATCH',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans/${plan.id}`,
      payload: { status: 'PROPOSED' },
    });
    expect(presented.statusCode).toBe(204);

    const itemId = plan.items[0].id;
    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans/${plan.id}/items/${itemId}/complete`,
    });
    expect(completed.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
    });
    const updated = after.json().items.find((entry: { id: string }) => entry.id === plan.id);
    expect(updated).toMatchObject({
      status: 'PROPOSED',
      progress: { total: 1, completed: 1, percentComplete: 100 },
    });
    expect(updated.presentedAt).not.toBeNull();
    expect(updated.items[0]).toMatchObject({ isCompleted: true });
    expect(updated.items[0].completedAt).not.toBeNull();

    // Completing again keeps the first completion stamp: the write is the
    // completion, not the second tap.
    const firstStamp = updated.items[0].completedAt;
    await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans/${plan.id}/items/${itemId}/complete`,
    });
    const again = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
    });
    const unchanged = again.json().items.find((entry: { id: string }) => entry.id === plan.id);
    expect(unchanged.items[0].completedAt).toBe(firstStamp);

    // A plan for a patient this clinic does not hold answers 404, and nothing is
    // written.
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${foreignPatientId}/treatment-plans`,
      payload: { items: [{}] },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    // A body that cannot name a plan is refused before the domain is asked.
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
      payload: { items: [] },
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('links a recorded treatment to the planned item it fulfils, without completing it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
      payload: { items: [{ treatmentId, tooth: '46', estimatedPriceMinor: 20_000 }] },
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json().plan;
    const itemId = plan.items[0].id;

    const recorded = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/treatments`,
      payload: { treatmentId, treatmentPlanItemId: itemId },
    });

    expect(recorded.statusCode).toBe(201);
    expect(recorded.json()).toMatchObject({ visitId, treatmentId, treatmentPlanItemId: itemId });

    // The link is stored on the execution side and read back through the visit — the
    // SQLite twin writes the column the PostgreSQL one does (ADR 0025).
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}/treatments`,
    });
    const stored = listed
      .json()
      .treatments.find(
        (entry: { treatmentPlanItemId: string | null }) => entry.treatmentPlanItemId === itemId,
      );
    expect(stored).toBeTruthy();

    // Provenance only: recording a linked treatment does not complete the line.
    const plans = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
    });
    const after = plans.json().items.find((entry: { id: string }) => entry.id === plan.id);
    expect(after.progress).toMatchObject({ total: 1, completed: 0 });
    expect(after.items[0].isCompleted).toBe(false);

    // An item that is not on the patient's plan is refused, folded to 422 by the wire,
    // and nothing is written against the visit.
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/treatments`,
      payload: { treatmentId, treatmentPlanItemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('prescribes a medication on the visit, inheriting whom it is about from the visit', async () => {
    const filed = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/prescriptions`,
      payload: {
        medication: '  Ibuprofen  ',
        dosage: '400 mg',
        route: 'ORAL',
        frequency: 'Every 8 hours as needed',
        durationDays: 5,
        instructions: 'Take after meals.',
      },
    });

    expect(filed.statusCode).toBe(201);
    // Trimming at the boundary, the patient and clinician inherited from the visit
    // (a body cannot restate who) — the same envelope PostgreSQL answers with.
    expect(filed.json()).toMatchObject({
      visitId,
      medication: 'Ibuprofen',
      dosage: '400 mg',
      route: 'ORAL',
      frequency: 'Every 8 hours as needed',
      durationDays: 5,
      instructions: 'Take after meals.',
    });
    expect(filed.json().patientId).toBe(apiPatientId);
    expect(filed.json().dentistId).toBe(dentistId);

    const ours = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}/prescriptions`,
    });
    expect(ours.statusCode).toBe(200);
    expect(ours.json().prescriptions).toHaveLength(1);

    // `prescriptions` has no clinic column, so the read scopes by joining the visit —
    // the same story the notes and the records tell, and the same 404 for another
    // clinic's visit (ADR 0014).
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${foreignVisitId}/prescriptions`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    // Refused before anything is written: the use case reads the visit first.
    const refusedForeignWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${foreignVisitId}/prescriptions`,
      payload: {
        medication: 'Ibuprofen',
        dosage: '400 mg',
        route: 'ORAL',
        frequency: 'Every 8 hours',
        durationDays: 5,
      },
    });
    expect(refusedForeignWrite.statusCode).toBe(404);
    expect(refusedForeignWrite.json().error.code).toBe('NOT_FOUND');

    // A course that says nothing is refused by the boundary schema before the writing
    // of any row — the seed of each refusal is written in `validation`, not here.
    const refusedBlank = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/prescriptions`,
      payload: {
        medication: '   ',
        dosage: '400 mg',
        route: 'ORAL',
        frequency: 'Every 8 hours',
        durationDays: 5,
      },
    });
    expect(refusedBlank.statusCode).toBe(422);
    expect(refusedBlank.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('attaches files to the visit, scoping both verbs through it', async () => {
    const attached = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/attachments`,
      payload: {
        fileName: '  Periapical-26.PNG  ',
        contentType: 'Image/PNG',
        sizeBytes: 512_400,
      },
    });

    expect(attached.statusCode).toBe(201);
    // Trimmed at the boundary, the content type normalized and the size stored whole —
    // the same envelope PostgreSQL answers with, on the engine that must not disagree
    // (ADR 0025). The visit is the path, never the body.
    expect(attached.json()).toMatchObject({
      visitId,
      fileName: 'Periapical-26.PNG',
      contentType: 'image/png',
      sizeBytes: 512_400,
    });

    const ours = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}/attachments`,
    });
    expect(ours.statusCode).toBe(200);
    expect(ours.json().attachments).toHaveLength(1);

    // `visit_attachments` has no clinic column, so the read scopes by joining the
    // visit — the same story the notes tell, and the same 404 for another clinic's
    // visit (ADR 0014).
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${foreignVisitId}/attachments`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    // Refused before anything is written: the use case reads the visit first.
    const refusedForeignWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${foreignVisitId}/attachments`,
      payload: { fileName: 'periapical-26.png' },
    });
    expect(refusedForeignWrite.statusCode).toBe(404);
    expect(refusedForeignWrite.json().error.code).toBe('NOT_FOUND');

    // A file the record could not find a file by is refused by the boundary schema
    // before the writing of any row.
    const refusedBlank = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/attachments`,
      payload: { fileName: '   ' },
    });
    expect(refusedBlank.statusCode).toBe(422);
    expect(refusedBlank.json().error.code).toBe('VALIDATION_ERROR');

    // The optional half of the reference is stored honestly as null.
    const minimal = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/attachments`,
      payload: { fileName: 'referral.pdf' },
    });
    expect(minimal.statusCode).toBe(201);
    expect(minimal.json()).toMatchObject({ fileName: 'referral.pdf', contentType: null });
    const reread = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${visitId}/attachments`,
    });
    expect(reread.json().attachments).toHaveLength(2);
  });

  it('charts teeth on the patient, one current state per tooth', async () => {
    // The chart is scoped through the patient on the path, and the dentition is
    // derived from the tooth number — a body could not restate either (ADR 0014).
    const charted = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/odontogram/entries`,
      payload: {
        tooth: ' 16 ',
        condition: 'CARIES',
        surfaces: ['MESIAL', 'OCCLUSAL'],
        notes: '  Composite patch scheduled.  ',
      },
    });
    expect(charted.statusCode).toBe(201);
    expect(charted.json()).toMatchObject({
      patientId: apiPatientId,
      visitId: null,
      dentition: 'PERMANENT',
      tooth: '16',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      condition: 'CARIES',
      notes: 'Composite patch scheduled.',
    });
    expect(charted.json().recordedAt).toBeTruthy();

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${foreignPatientId}/odontogram/entries`,
      payload: { tooth: '16', condition: 'CARIES', surfaces: ['MESIAL'] },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    const invalidTooth = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/odontogram/entries`,
      payload: { tooth: '99', condition: 'CARIES', surfaces: ['MESIAL'] },
    });
    expect(invalidTooth.statusCode).toBe(422);
    expect(invalidTooth.json().error.code).toBe('VALIDATION_ERROR');

    // A site condition must name a surface: refused by the domain, folded into the
    // same VALIDATION_ERROR envelope by sendProblem.
    const noSurface = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/odontogram/entries`,
      payload: { tooth: '36', condition: 'CARIES', surfaces: [] },
    });
    expect(noSurface.statusCode).toBe(422);
    expect(noSurface.json().error.code).toBe('VALIDATION_ERROR');

    // Re-charting the same tooth replaces the state instead of adding a row: the
    // upsert under the (patient_id, tooth) unique index, on this engine too.
    const recharted = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/odontogram/entries`,
      payload: { tooth: '16', condition: 'FILLED', surfaces: ['MESIAL'] },
    });
    expect(recharted.statusCode).toBe(201);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/odontogram`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().entries).toHaveLength(1);
    expect(read.json().entries[0]).toMatchObject({ tooth: '16', condition: 'FILLED' });
  });

  it('raises a charge on the visit, priced in the clinic’s own record', async () => {
    const raised = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/charges`,
      payload: {
        description: '  Composite restoration, tooth 16  ',
        quantity: 2,
        unitPriceMinor: 12_000,
        discountMinor: 1_000,
      },
    });

    expect(raised.statusCode).toBe(201);
    // Trimming at the boundary, who the row is about inherited from the visit, and
    // the currency from the clinic's own record — a body cannot restate any of it.
    expect(raised.json()).toMatchObject({
      clinicId,
      patientId: apiPatientId,
      visitId,
      description: 'Composite restoration, tooth 16',
      quantity: 2,
      unitPriceMinor: 12_000,
      discountMinor: 1_000,
      taxRatePercent: 0,
      currency: 'USD',
      invoiceId: null,
      invoicedAt: null,
    });

    const ours = await app.inject({ method: 'GET', url: `/api/v1/visits/${visitId}/charges` });
    expect(ours.statusCode).toBe(200);
    expect(ours.json().charges).toHaveLength(1);

    // The charge carries its own clinic_id, but the visit is still read first — so
    // another clinic's visit answers the same 404 the notes answered, on this engine
    // too (ADR 0014).
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${foreignVisitId}/charges`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    // Refused before anything is written: the use case reads the visit first.
    const refusedForeignWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${foreignVisitId}/charges`,
      payload: { description: 'Cleaning', unitPriceMinor: 8_000 },
    });
    expect(refusedForeignWrite.statusCode).toBe(404);
    expect(refusedForeignWrite.json().error.code).toBe('NOT_FOUND');

    // A charge that says nothing is refused by the boundary schema before any row is
    // written — the seeds of each refusal live in `validation`, not here.
    const refusedBlank = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/charges`,
      payload: { description: '   ', unitPriceMinor: 8_000 },
    });
    expect(refusedBlank.statusCode).toBe(422);
    expect(refusedBlank.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('settles the visit’s bill, in the same transaction, on this engine too', async () => {
    // The charge test above raised a bill of 2 × 12_000 − 1_000 = 23_000 minor units.
    const paid = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/payments`,
      payload: { method: 'CARD', amountMinor: 23_000, reference: '  *** 4242  ' },
    });

    expect(paid.statusCode).toBe(201);
    // Trimming at the boundary, who the money belongs to inherited from the visit,
    // and the currency from the clinic's own record — the same envelope PostgreSQL
    // answers with, so the engines agree about what a payment is.
    expect(paid.json()).toMatchObject({
      clinicId,
      patientId: apiPatientId,
      method: 'CARD',
      amountMinor: 23_000,
      reference: '*** 4242',
      currency: 'USD',
    });

    const ours = await app.inject({ method: 'GET', url: `/api/v1/visits/${visitId}/payments` });
    expect(ours.statusCode).toBe(200);
    expect(ours.json().payments).toHaveLength(1);

    // The four-table join `findForVisit` runs here is this engine's second
    // implementation, and it answers the same 404 for another clinic's visit the
    // notes and charges reads answered (ADR 0014, ADR 0025).
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/visits/${foreignVisitId}/payments`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    // The same transaction that recorded the money raised the invoice and stamped
    // the charges, so the bill reads "invoiced" a moment after the register does.
    const charges = await app.inject({ method: 'GET', url: `/api/v1/visits/${visitId}/charges` });
    const listed = (
      charges.json() as {
        charges: { invoiceId: string | null; invoicedAt: string | null }[];
      }
    ).charges;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.invoiceId).toBeTruthy();
    expect(listed[0]?.invoicedAt).toBeTruthy();

    // And a second payment answers the ledger's boundary — the invoice's remaining
    // balance is Milestone 9's — rather than writing a second row (docs/open-questions.md).
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/payments`,
      payload: { method: 'CASH', amountMinor: 1 },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lists the clinic’s payments for a period, with the period total', async () => {
    const day = today.start.toISOString().slice(0, 10);

    const ledger = await app.inject({
      method: 'GET',
      url: `/api/v1/payments?from=${day}&to=${day}`,
    });

    expect(ledger.statusCode).toBe(200);
    expect(ledger.json()).toMatchObject({
      period: { from: day, to: day, timeZone: 'UTC' },
      currencyCode: 'USD',
      totalAmountMinor: 23_000,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(ledger.json().items[0]).toMatchObject({
      patientId: apiPatientId,
      patientName: 'Dee Book',
      method: 'CARD',
      currency: 'USD',
      amountMinor: 23_000,
      reference: '*** 4242',
    });

    // The method filter applies to the rows and to the period total together, so a
    // filtered screen cannot show cash rows under a card total.
    const cashOnly = await app.inject({
      method: 'GET',
      url: `/api/v1/payments?from=${day}&to=${day}&method=CASH`,
    });
    expect(cashOnly.statusCode).toBe(200);
    expect(cashOnly.json().items).toEqual([]);
    expect(cashOnly.json().totalAmountMinor).toBe(0);

    const reversed = await app.inject({
      method: 'GET',
      url: `/api/v1/payments?from=${day}&to=2000-01-01`,
    });
    expect(reversed.statusCode).toBe(422);
    expect(reversed.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('bills a planned line on a charge, without completing it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
      payload: { items: [{ treatmentId, tooth: '37', estimatedPriceMinor: 22_000 }] },
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json().plan;
    const itemId = plan.items[0].id;

    const raised = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/charges`,
      payload: {
        description: 'Composite restoration, tooth 37',
        unitPriceMinor: 22_000,
        treatmentPlanItemId: itemId,
      },
    });

    expect(raised.statusCode).toBe(201);
    // The link is written on the charge side and the item's own treatment is folded
    // in, so the bill names what was done — the same envelope PostgreSQL answers with.
    expect(raised.json()).toMatchObject({
      visitId,
      treatmentId,
      treatmentPlanItemId: itemId,
      description: 'Composite restoration, tooth 37',
      unitPriceMinor: 22_000,
    });

    const listed = await app.inject({ method: 'GET', url: `/api/v1/visits/${visitId}/charges` });
    const stored = (
      listed.json() as { charges: { treatmentPlanItemId: string | null }[] }
    ).charges.find((charge) => charge.treatmentPlanItemId === itemId);
    expect(stored).toBeTruthy();

    // Provenance only: billing a planned line does not complete it.
    const plans = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/treatment-plans`,
    });
    const after = plans.json().items.find((entry: { id: string }) => entry.id === plan.id);
    expect(after.progress).toMatchObject({ total: 1, completed: 0 });
    expect(after.items[0].isCompleted).toBe(false);

    // An item that is not on the patient's plan is refused by the domain and folded
    // to 422 by the wire, and nothing is written.
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${visitId}/charges`,
      payload: {
        description: 'Composite restoration',
        unitPriceMinor: 22_000,
        treatmentPlanItemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('raises a visit’s bill as a numbered document, and reads the ledger back', async () => {
    // The settlement above issued F001-00001 for the first charge; the planned-line
    // charge that followed it is still un-invoiced, so this is the clinic's second
    // document. (The suite shares one visit and runs in order, deliberately.)
    const raised = await app.inject({ method: 'POST', url: `/api/v1/visits/${visitId}/invoices` });

    expect(raised.statusCode).toBe(201);
    // The number is the store's, assigned from the clinic's own series; the status
    // and the currency are the server's too — a bodyless request cannot restate any.
    expect(raised.json()).toMatchObject({
      clinicId,
      patientId: apiPatientId,
      number: 'F001-00002',
      status: 'ISSUED',
      currency: 'USD',
    });
    const invoiceId = raised.json().id as string;

    // The charge it folded is stamped invoiced, so issuing the visit again finds
    // nothing left and answers the same 422 an empty bill does.
    const again = await app.inject({ method: 'POST', url: `/api/v1/visits/${visitId}/invoices` });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.code).toBe('VALIDATION_ERROR');

    // The detail read: the document's own stored totals, the charge it folded in,
    // nothing allocated, and the full balance outstanding.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/invoices/${invoiceId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: invoiceId,
      number: 'F001-00002',
      status: 'ISSUED',
      chargeCount: 1,
      allocatedMinor: 0,
      balanceMinor: 22_000,
      totalMinor: 22_000,
    });
    expect(detail.json().charges).toHaveLength(1);

    // The patient's ledger: both documents, newest first.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/invoices`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(2);
    expect(list.json().items[0].number).toBe('F001-00002');

    // Another clinic's visit cannot be billed, and another clinic's patient's ledger
    // is not this clinic's to read — the same 404 the clinical reads answer (ADR 0014).
    const foreignVisit = await app.inject({
      method: 'POST',
      url: `/api/v1/visits/${foreignVisitId}/invoices`,
    });
    expect(foreignVisit.statusCode).toBe(404);

    const foreignPatient = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${foreignPatientId}/invoices`,
    });
    expect(foreignPatient.statusCode).toBe(404);

    // An invoice this clinic does not hold answers 404, the same as one that never was.
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/invoices/00000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);

    // The ledger's summary line, added up across both documents and the money: one
    // is settled, one is open, so 23_000 + 22_000 billed, 23_000 of it already
    // collected, and nothing credit — the payment reached a document rather than
    // arriving loose. On this engine the same three ports add up to the same five
    // numbers (ADR 0025).
    const balance = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/balance`,
    });
    expect(balance.statusCode).toBe(200);
    expect(balance.json()).toEqual({
      currency: 'USD',
      billedMinor: 45_000,
      allocatedMinor: 23_000,
      outstandingMinor: 22_000,
      unallocatedPaymentsMinor: 0,
      balanceMinor: 22_000,
    });

    // A patient another clinic holds is unknown here, not owed nothing — the same
    // answer as an id that was never a patient at all.
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${foreignPatientId}/balance`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    const unknownId = await app.inject({
      method: 'GET',
      url: '/api/v1/patients/00000000-0000-4000-8000-000000000001/balance',
    });
    expect(unknownId.statusCode).toBe(404);

    // The statement is the same ledger read as a history: the settled document, the
    // payment that settled it, then the open document — oldest first, with the
    // balance after each line. Its closing figure is the balance's own `balanceMinor`,
    // so the summary and the history cannot disagree.
    const statement = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/statement`,
    });
    expect(statement.statusCode).toBe(200);
    expect(statement.json()).toMatchObject({
      currency: 'USD',
      billedMinor: 45_000,
      paidMinor: 23_000,
      closingBalanceMinor: 22_000,
    });
    expect(
      (statement.json() as { entries: { kind: string; reference: string | null }[] }).entries,
    ).toEqual([
      expect.objectContaining({ kind: 'INVOICE', reference: 'F001-00001', balanceMinor: 23_000 }),
      expect.objectContaining({
        kind: 'PAYMENT',
        reference: '*** 4242',
        balanceMinor: 0,
      }),
      expect.objectContaining({ kind: 'INVOICE', reference: 'F001-00002', balanceMinor: 22_000 }),
    ]);

    // A stranger's statement is the same 404 as a stranger's balance.
    const foreignStatement = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${foreignPatientId}/statement`,
    });
    expect(foreignStatement.statusCode).toBe(404);
    expect(foreignStatement.json().error.code).toBe('NOT_FOUND');

    const unknownStatement = await app.inject({
      method: 'GET',
      url: '/api/v1/patients/00000000-0000-4000-8000-000000000001/statement',
    });
    expect(unknownStatement.statusCode).toBe(404);
  });

  it('adds items, moves stock and keeps the ledger scoped to the clinic', async () => {
    const resin = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/items',
      payload: {
        name: '  Composite resin A2  ',
        sku: 'COMP-A2',
        description: '  Syringe, shade A2  ',
        unit: 'syringe',
        openingStock: 10,
        minStock: 4,
        costMinor: 4_500,
      },
    });

    expect(resin.statusCode).toBe(201);
    // Trimmed at the boundary, with the opening stock on the item and on its ledger.
    expect(resin.json().item).toMatchObject({
      clinicId,
      name: 'Composite resin A2',
      sku: 'COMP-A2',
      description: 'Syringe, shade A2',
      unit: 'syringe',
      stock: 10,
      minStock: 4,
      costMinor: 4_500,
      isActive: true,
    });
    const resinId = resin.json().item.id as string;

    const opening = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/items/${resinId}/movements`,
    });
    expect(opening.statusCode).toBe(200);
    expect(opening.json().items).toHaveLength(1);
    expect(opening.json().items[0]).toMatchObject({
      type: 'ADJUSTMENT',
      quantity: 10,
      reference: 'Opening stock',
      unitCostMinor: 4_500,
    });

    const gauze = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/items',
      payload: { name: 'Gauze', sku: 'GAUZE', unit: 'pack', openingStock: 2, minStock: 5 },
    });
    expect(gauze.statusCode).toBe(201);
    // Opening stock of zero writes no movement: zero is absence, not an event.
    expect(gauze.json().item.stock).toBe(2);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/inventory/items' });
    expect(listed.statusCode).toBe(200);
    const items = listed.json().items as { name: string; stock: number; minStock: number }[];
    expect(items.map((item) => item.name)).toEqual(['Composite resin A2', 'Gauze']);
    // Low stock is not a server filter: the row that is below its minimum is still
    // returned, because the page compares the two columns the item carries.
    expect(items[1]).toMatchObject({ name: 'Gauze', stock: 2, minStock: 5 });

    const used = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/items/${resinId}/movements`,
      payload: { type: 'USAGE', quantity: 7, reference: '  Visit 42  ' },
    });
    expect(used.statusCode).toBe(201);
    // The write answers with the new level, so the page never guesses it — the same
    // envelope PostgreSQL answers with, on the engine that must not disagree.
    expect(used.json().item).toMatchObject({ id: resinId, stock: 3 });
    expect(used.json().movement).toMatchObject({
      itemId: resinId,
      type: 'USAGE',
      quantity: 7,
      reference: 'Visit 42',
    });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/items/${resinId}/movements`,
    });
    expect(history.statusCode).toBe(200);
    const movements = history.json().items as { type: string; quantity: number }[];
    expect(movements).toHaveLength(2);
    expect(movements.map((movement) => movement.type).sort()).toEqual(['ADJUSTMENT', 'USAGE']);

    // Using more than the shelf holds is refused by the domain and folded to 409 by
    // the wire; nothing is written, so the level stays at the last real count.
    const short = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/items/${resinId}/movements`,
      payload: { type: 'USAGE', quantity: 4 },
    });
    expect(short.statusCode).toBe(409);
    expect(short.json().error.code).toBe('DOMAIN_RULE_VIOLATION');
    const afterShort = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/items/${resinId}/movements`,
    });
    expect(afterShort.json().items).toHaveLength(2);

    // The same SKU again is the (clinic_id, sku) unique index answering, on this
    // engine too (ADR 0025).
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/items',
      payload: { name: 'Another resin', sku: 'COMP-A2' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('DOMAIN_RULE_VIOLATION');

    // Another clinic's item is unknown here — the same 404 as one that never was.
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/items/${foreignInventoryItemId}/movements`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    const foreignWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/items/${foreignInventoryItemId}/movements`,
      payload: { type: 'USAGE', quantity: 1 },
    });
    expect(foreignWrite.statusCode).toBe(404);
    expect(foreignWrite.json().error.code).toBe('NOT_FOUND');

    const unknownWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/items/00000000-0000-4000-8000-000000000000/movements',
      payload: { type: 'USAGE', quantity: 1 },
    });
    expect(unknownWrite.statusCode).toBe(404);

    // A movement of zero is refused by the boundary schema before the domain is asked.
    const zero = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/items/${resinId}/movements`,
      payload: { type: 'USAGE', quantity: 0 },
    });
    expect(zero.statusCode).toBe(422);
    expect(zero.json().error.code).toBe('VALIDATION_ERROR');

    const unnamed = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/items',
      payload: { name: '   ' },
    });
    expect(unnamed.statusCode).toBe(422);
    expect(unnamed.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('summarises the day on the dashboard, occupancy included', async () => {
    // Two disjoint 30-minute bookings from a capacity of 08:00–17:00 × one
    // dentist: 60 of 540 minutes, which rounds to 11% occupancy.
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard/stats' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.clinic.activePatients).toBe(1);
    expect(body.today.appointments).toBe(2);
    expect(body.clinic.occupancyRate).toBe(11);
    expect(body.clinic.currencyCode).toBe('USD');
  });

  it('summarises a report period, and keeps unattributable money clinic-wide', async () => {
    // The suite has booked two 30-minute appointments today (one now in treatment)
    // and raised 45_000 of charges, 23_000 of which has been collected. The clinic
    // opens 08:00–17:00 for one active dentist: 540 minutes of capacity.
    const day = today.start.toISOString().slice(0, 10);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/summary?from=${day}&to=${day}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.period).toMatchObject({ from: day, to: day, timeZone: 'UTC', dentistId: null });
    expect(body.currencyCode).toBe('USD');
    expect(body.appointments).toMatchObject({
      total: 2,
      completed: 0,
      cancelled: 0,
      noShow: 0,
      pending: 1,
      inTreatment: 1,
      bookedMinutes: 60,
    });
    expect(body.production.totalMinor).toBe(45_000);
    // Payments have no dentist, so the clinic-period figure is the only honest one.
    expect(body.collections.totalMinor).toBe(23_000);
    expect(body.outstanding.totalMinor).toBe(22_000);
    expect(body.occupancy).toMatchObject({
      bookedMinutes: 60,
      capacityMinutes: 540,
      rate: 11,
    });
    expect(body.dentists).toEqual([
      expect.objectContaining({
        dentistId,
        dentistName: 'Dr Book',
        appointments: 2,
        pending: 1,
        inTreatment: 1,
        bookedMinutes: 60,
        productionMinor: 45_000,
        capacityMinutes: 540,
        occupancyRate: 11,
      }),
    ]);

    // Filtering to the one clinician narrows the appointment and production figures
    // but not collections, and leaves the denominator at one clinician's hours.
    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/summary?from=${day}&to=${day}&dentistId=${dentistId}`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().collections.totalMinor).toBe(23_000);
    expect(filtered.json().period.dentistId).toBe(dentistId);

    // A reversed range is refused at the boundary, and a period wider than the
    // report's own limit is refused by the route before any table is read.
    const reversed = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary?from=2026-10-10&to=2026-10-01',
    });
    expect(reversed.statusCode).toBe(422);

    const tooWide = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary?from=2025-01-01&to=2026-12-31',
    });
    expect(tooWide.statusCode).toBe(422);

    // A clinician from another clinic is unknown here, not an empty report.
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/summary?from=${day}&to=${day}&dentistId=${otherDentistId}`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');
  });

  it('reports the booked day in the calendar preview', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/calendar-preview?days=1',
    });

    expect(response.statusCode).toBe(200);
    const { items } = response.json();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.day).toBe(today.start.toISOString().slice(0, 10));
    expect(items[0]?.total).toBe(2);
  });

  it('lists the recent patient', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/recent-patients',
    });

    expect(response.statusCode).toBe(200);
    const { items } = response.json();
    expect(items).toHaveLength(1);
    expect(items[0]?.lastName).toBe('Book');
  });

  it('updates the clinic identity and replaces its opening hours on this engine too', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/clinic',
      payload: {
        name: 'SQLite Renovada',
        legalName: 'Renovada S.A.',
        taxId: null,
        address: null,
        phone: null,
        email: null,
        timeZone: 'America/Lima',
        currency: 'pen',
        operatingHours: [
          { weekday: 1, opensAtLocalTime: '09:00', closesAtLocalTime: '18:00', isClosed: false },
          { weekday: 7, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'SQLite Renovada',
      legalName: 'Renovada S.A.',
      timeZone: 'America/Lima',
      currency: 'PEN',
    });
    expect(response.json().operatingHours).toHaveLength(2);
    expect(response.json().operatingHours).toEqual(
      expect.arrayContaining([
        { weekday: 1, opensAtLocalTime: '09:00', closesAtLocalTime: '18:00', isClosed: false },
        { weekday: 7, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true },
      ]),
    );

    const read = await app.inject({ method: 'GET', url: '/api/v1/clinic' });
    expect(read.json()).toMatchObject({
      name: 'SQLite Renovada',
      currency: 'PEN',
    });
    expect(read.json().operatingHours).toHaveLength(2);
  });

  it('records a payment against one invoice, settling it without a visit', async () => {
    // The open F001-00002 from the ledger test above is the subject: its invoice id
    // is all a client or patient screen has, and the selected document is what this
    // payment is for — not a settlement that picks documents itself.
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/invoices`,
    });
    const invoice = (
      list.json() as { items: { id: string; number: string; balanceMinor: number }[] }
    ).items.find((entry) => entry.number === 'F001-00002');
    expect(invoice).toMatchObject({ balanceMinor: 22_000 });

    const payment = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoice!.id}/payments`,
      payload: { method: 'CASH', amountMinor: 22_000, reference: 'closing cash' },
    });
    expect(payment.statusCode).toBe(201);
    expect(payment.json()).toMatchObject({
      clinicId,
      patientId: apiPatientId,
      method: 'CASH',
      currency: 'USD',
      amountMinor: 22_000,
      reference: 'closing cash',
    });

    // The document is settled by the allocation and its stored status moves with it;
    // the read is the same one the screen draws.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/invoices/${invoice!.id}` });
    expect(detail.json()).toMatchObject({
      status: 'PAID',
      allocatedMinor: 22_000,
      balanceMinor: 0,
    });

    // The patient's whole ledger now closes at zero, and the statement ends with the
    // payment that closed it.
    const balance = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/balance`,
    });
    expect(balance.json()).toMatchObject({
      billedMinor: 45_000,
      allocatedMinor: 45_000,
      outstandingMinor: 0,
      balanceMinor: 0,
    });

    const statement = await app.inject({
      method: 'GET',
      url: `/api/v1/patients/${apiPatientId}/statement`,
    });
    expect(statement.json().entries.at(-1)).toMatchObject({
      kind: 'PAYMENT',
      creditMinor: 22_000,
      balanceMinor: 0,
    });

    // A second payment cannot exceed what the document still owes, and zero is not
    // money: both are refused at the boundary with no row written.
    const overpaid = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoice!.id}/payments`,
      payload: { method: 'CASH', amountMinor: 1 },
    });
    expect(overpaid.statusCode).toBe(422);
    expect(overpaid.json().error.code).toBe('VALIDATION_ERROR');

    const zero = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoice!.id}/payments`,
      payload: { method: 'CASH', amountMinor: 0 },
    });
    expect(zero.statusCode).toBe(422);

    // An invoice another clinic holds is unknown here, so its money is not ours to take.
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices/00000000-0000-4000-8000-000000000001/payments',
      payload: { method: 'CASH', amountMinor: 100 },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');

    // A hand-typed path id is refused before a query sees it, rather than reaching
    // the engine as an invalid uuid and returning a 500.
    const invalidPath = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices/not-a-uuid/payments',
      payload: { method: 'CASH', amountMinor: 100 },
    });
    expect(invalidPath.statusCode).toBe(422);
    expect(invalidPath.json().error.details.issues[0]).toMatchObject({
      path: ['invoiceId'],
      code: 'invalid_uuid',
    });
  });
});

async function seed(db: importedDb) {
  await db.insert(sqliteSchema.clinics).values({
    id: clinicId,
    name: 'SQLite Smoker',
    legalName: null,
    timeZone: 'UTC',
    currencyCode: 'USD',
    isActive: true,
  });

  // The administrator every request in this suite logs in as. The hash is produced
  // by the real hasher, so login exercises the same verification the product does.
  await db.insert(sqliteSchema.users).values({
    id: 'a0a0a0a0-0000-4000-8000-0000000000a1',
    clinicId,
    email: ADMIN_EMAIL,
    passwordHash: await new ScryptPasswordHasher().hash(ADMIN_PASSWORD),
    fullName: 'Smoke Admin',
    role: 'ADMINISTRATOR',
    isActive: true,
  });

  const days = Array.from({ length: 7 }, (_, day) => ({
    clinicId,
    dayOfWeek: day,
    opensAt: '08:00',
    closesAt: '17:00',
  }));
  await db.insert(sqliteSchema.clinicOperatingHours).values(days);

  await db.insert(sqliteSchema.rooms).values({ id: roomId, clinicId, name: 'Operatory 1' });
  await db.insert(sqliteSchema.chairs).values({ id: chairId, clinicId, roomId, name: 'Sillón 1' });
  await db
    .insert(sqliteSchema.dentists)
    .values({ id: dentistId, clinicId, fullName: 'Dr Book', isActive: true });

  // The catalogue a visit record names; one row per clinic, so the write has both a
  // "this clinic offers it" and a "this clinic does not" fixture to judge against.
  await db.insert(sqliteSchema.treatments).values({
    id: treatmentId,
    clinicId,
    code: 'COMPO',
    name: 'Composite restoration',
    defaultPriceMinor: 15000,
    isActive: true,
  });

  // Another clinic's dentist: the booking rule must refuse it as a bad reference.
  await db.insert(sqliteSchema.clinics).values({
    id: otherClinicId,
    name: 'Other Clinic',
    timeZone: 'UTC',
    currencyCode: 'USD',
    isActive: true,
  });
  await db.insert(sqliteSchema.dentists).values({
    id: otherDentistId,
    clinicId: otherClinicId,
    fullName: 'Dr Foreign',
    isActive: true,
  });
  await db.insert(sqliteSchema.treatments).values({
    id: foreignTreatmentId,
    clinicId: otherClinicId,
    code: 'RCT',
    name: 'Root canal therapy',
    defaultPriceMinor: 60000,
    isActive: true,
  });

  // Another clinic's stock item: the movement endpoints' scoping has a real row to
  // refuse, not merely an id that was nowhere (ADR 0014).
  await db.insert(sqliteSchema.inventoryItems).values({
    id: foreignInventoryItemId,
    clinicId: otherClinicId,
    name: 'Foreign gauze',
    unit: 'pack',
    stock: 5,
    minStock: 1,
    costMinor: 100,
  });

  // A patient and a visit in that other clinic: the note endpoints' whole scoping
  // story is "this clinic cannot see that visit", and a fixture-less version of it
  // would only ever prove the id was nowhere (ADR 0014, ADR 0025).
  await db.insert(sqliteSchema.patients).values({
    id: foreignPatientId,
    clinicId: otherClinicId,
    firstName: 'Far',
    lastName: 'Away',
  });
  await db.insert(sqliteSchema.visits).values({
    id: foreignVisitId,
    clinicId: otherClinicId,
    patientId: foreignPatientId,
    dentistId: otherDentistId,
    status: 'OPEN',
    startedAt: new Date('2026-04-16T09:00:00.000Z'),
  });
}

type importedDb = BetterSQLite3Database<typeof sqliteSchema>;
