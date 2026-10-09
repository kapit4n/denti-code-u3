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

describe('API on SQLite', () => {
  let dir: string;
  let app: DentiApiServer;

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
      payload: { firstName: 'Dee', lastName: 'Book' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.recordNumber).toBe('P-000001');
    expect(body.clinicId).toBe(clinicId);
    apiPatientId = body.id;
    expect(apiPatientId).toBeTruthy();
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
