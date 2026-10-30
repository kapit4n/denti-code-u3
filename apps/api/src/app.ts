/**
 * The Fastify server factory.
 *
 * Exported separately from `main.ts` so tests can build a fully configured
 * server without opening a port: `buildServer()` returns an instance that is
 * ready to `.inject()` requests but has not called `.listen()`.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import { loadApiConfig, type ApiConfig, type EnvSource } from './config/env.js';
import { loggerOptions } from './config/logger.js';
import {
  openDatabaseConnection,
  type DatabaseConnection,
} from './infrastructure/persistence/connection.js';
import { registerCors } from './http/plugins/cors.js';
import { registerAuth } from './http/plugins/auth.js';
import { registerAuthRoutes } from './http/routes/auth.js';
import { registerDevAuthRoutes } from './http/routes/dev-auth.js';
import { registerHealthRoutes } from './http/routes/health.js';
import { registerDashboardRoutes } from './http/routes/dashboard.js';
import { registerReportsRoutes } from './http/routes/reports.js';
import { registerAppointmentsRoutes } from './http/routes/appointments.js';
import { registerClinicRoutes } from './http/routes/clinic.js';
import { registerDentistsRoutes } from './http/routes/dentists.js';
import { registerChairsRoutes } from './http/routes/chairs.js';
import { registerTreatmentsRoutes } from './http/routes/treatments.js';
import { registerInventoryRoutes } from './http/routes/inventory.js';
import { registerVisitsRoutes } from './http/routes/visits.js';
import { registerInvoiceRoutes } from './http/routes/invoices.js';
import { registerPaymentsRoutes } from './http/routes/payments.js';
import { registerPatientsRoutes } from './http/routes/patients.js';
import { registerTreatmentPlanRoutes } from './http/routes/treatment-plans.js';
import { systemClock } from './infrastructure/clock/system-clock.js';
import { uuidGenerator } from './infrastructure/id/uuid-generator.js';
import { LoginRateLimiter } from './infrastructure/security/login-rate-limiter.js';
import { ScryptPasswordHasher } from './infrastructure/security/scrypt-password-hasher.js';
import { CryptoTokenGenerator } from './infrastructure/security/token-generator.js';
import { sendProblem } from './http/problem.js';

export interface ServerDependencies {
  readonly config: ApiConfig;
  readonly connection: DatabaseConnection;
}

/**
 * `buildServer` returns the Fastify instance unchanged.
 *
 * Shutdown needs no extra handle: the `onClose` hook drains the database pool, so
 * `server.close()` is the whole shutdown sequence. Fastify's instance type is
 * already thenable, and widening it with an extra method only made the return
 * value harder to type for no behavioural gain.
 */
export type DentiApiServer = FastifyInstance;

export async function buildServer(env: EnvSource = process.env): Promise<DentiApiServer> {
  const config = loadApiConfig(env);
  // The engine is chosen by the `DATABASE_URL` scheme — see
  // `infrastructure/persistence/connection.ts`. From here on the wiring speaks
  // only to ports, so nothing else in the process needs to know which engine
  // answered (ADR 0025).
  const connection = openDatabaseConnection(config.databaseUrl, config.clinicTimeZone);

  const app = Fastify({
    logger: loggerOptions(config),
    // Trust nothing implicitly: the desktop shell and the web app are different
    // origins, so the forwarded headers must be opted into per deployment.
    trustProxy: false,
    bodyLimit: 1_048_576,
    // Request logging stays ON (it is how a reported error is traced), which is
    // the Fastify 5 default; the option is no longer passed because the
    // top-level `disableRequestLogging` flag is deprecated.
  });

  /**
   * One error path for the whole application. Route handlers throw a DomainError
   * (or anything else); this turns it into the documented error envelope and
   * keeps stack traces and SQL text on the server.
   */
  app.setErrorHandler((error, request, reply) => sendProblem(reply, request, error));

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route matches ${request.method} ${request.url}`,
        requestId: request.id,
      },
    }),
  );

  await registerCors(app, config);
  await registerHealthRoutes(app, { config, connection });

  // Authentication, before every clinical route. It resolves the bearer token into
  // `request.principal` (and `request.clinicId`), and refuses any route that has
  // not declared itself public — so a route added later is protected by default
  // rather than public by omission. This replaced the config-based `clinic-scope`
  // plugin, which was the single-clinic stand-in for exactly this (ADR 0014, 0028).
  const auth = {
    users: connection.repositories.users,
    sessions: connection.repositories.sessions,
    passwordHasher: new ScryptPasswordHasher(),
    tokenGenerator: new CryptoTokenGenerator(),
    clock: systemClock,
    ids: uuidGenerator,
    sessionTtlHours: config.sessionTtlHours,
  };
  await registerAuth(app, { config, auth });
  // Failed sign-ins are counted in this process (ADR 0029). One limiter per
  // server means the state cannot leak between two tests' servers either.
  const loginRateLimiter = new LoginRateLimiter({
    maxAttempts: config.loginMaxAttempts,
    windowMs: config.loginWindowMinutes * 60_000,
  });
  await registerAuthRoutes(app, { auth, clinicId: config.clinicId, loginRateLimiter });

  // Testing affordance, absent in production: no flag to forget, no route to
  // disable (ADR 0030).
  if (config.nodeEnv !== 'production') {
    await registerDevAuthRoutes(app, { auth, clinicId: config.clinicId });
  }

  // Every reader and writer shares one repository per port, so "today" and "the
  // book" each have one implementation — the connection builds them once, behind
  // whichever engine answered. Two instances of one repository would be two
  // answers to one question.
  const {
    appointments,
    clinics,
    dentists,
    chairs,
    clinicalNotes,
    prescriptions,
    treatmentPlans,
    treatmentRecords,
    treatments,
  } = connection.repositories;

  await registerDashboardRoutes(app, {
    // The dashboard's aggregates answer through the connection's read store;
    // "today's book" is still the agenda query the calendar uses.
    dashboard: connection.dashboard,
    appointments,
  });

  // Management reporting. Its tables are read through the connection's report read
  // store; the route still needs the dentist list to name the performance rows and
  // to know how many chairs the clinic's hours are shared by.
  await registerReportsRoutes(app, {
    reports: connection.reports,
    dentists,
    clock: systemClock,
  });
  // One repository for the whole patient feature: the handlers get a port, so a
  // route cannot forget the clinic filter, and adding a read does not require
  // handing out the connection again. The odontogram chart joins it here as a
  // plain repository: charting a tooth is one upsert, and the use case reads the
  // patient in this clinic before it writes — the notes' read-then-write shape
  // (ADR 0014). The chart itself is read through the patient repository's
  // `findOdontogram`, not through a second door.
  await registerPatientsRoutes(app, {
    patients: connection.repositories.patients,
    odontogramEntries: connection.repositories.odontogramEntries,
    treatmentPlans: connection.repositories.treatmentPlans,
    ids: uuidGenerator,
    clock: systemClock,
  });

  // The writes need the clinic's own record, for opening hours: a clinic that opens
  // at 07:00 must not need a deployment to say so.
  await registerAppointmentsRoutes(app, {
    appointments,
    dentists,
    chairs,
    clinics,
    ids: uuidGenerator,
  });

  // The clinic's own record, so the browser renders the calendar in the clinic's
  // day rather than the visitor's.
  await registerClinicRoutes(app, { clinics });

  // The two resources a booking is made against. `POST /appointments` requires a
  // `dentistId` and accepts a `chairId`, so until these answered there was no way to
  // name one — the appointment write side had no read side to sit on.
  await registerDentistsRoutes(app, { dentists });
  await registerChairsRoutes(app, { chairs });

  // The catalogue a visit record names, and the door it grows through. Its own route
  // because it has its own address — a procedure is not a visit's property, and
  // neither `GET /visits/:id/treatments` (the visit's *records*) nor a nested
  // `GET /visits/:id/...` would say so.
  await registerTreatmentsRoutes(app, {
    treatments,
    ids: uuidGenerator,
  });

  // The clinic's consumable stock. Items carry their own clinic_id, so the reads
  // scope in the row; a movement and the item's cached level are written together,
  // which is why this door receives the unit of work rather than the repository
  // alone (the same seam the visit bridge uses, ADR 0021).
  await registerInventoryRoutes(app, {
    inventory: connection.repositories.inventory,
    unitOfWork: connection.unitOfWork,
    ids: uuidGenerator,
    clock: systemClock,
  });

  // The treatment-plan write side: proposing a plan for a patient, moving it along,
  // and marking a line done. Its read lives with the patient routes; the writes have
  // their own address here because a plan is a resource a plan screen opens on. It is
  // given the same repository instances the patient read uses, so a plan is written
  // and read through one door (ADR 0014).
  await registerTreatmentPlanRoutes(app, {
    patients: connection.repositories.patients,
    dentists,
    treatments,
    treatmentPlans: connection.repositories.treatmentPlans,
    ids: uuidGenerator,
    clock: systemClock,
  });

  // The bridge from scheduling to clinical, and the walk-in that has no bridge. It is
  // given a transaction rather than the two repositories, because starting a visit from
  // a booking writes both rows and a route wired with repositories could be handed them
  // separately (ADR 0021). The `UnitOfWork` builds its repositories per transaction, so
  // none of them can write outside it.
  await registerVisitsRoutes(app, {
    unitOfWork: connection.unitOfWork,
    // A plain repository alongside the transaction, because the walk-in and the two
    // closing endpoints write one row each (ADR 0022, ADR 0024).
    visits: connection.repositories.visits,
    // The notes are a plain repository too, and for a plainer reason than the
    // closures' one: a note has no clinic column, so the use case reads the visit in
    // this clinic before it writes — a read-then-write pair of statements has no
    // atomicity to protect (ADR 0014).
    clinicalNotes,
    // The files attached to a visit — the same read-then-write shape as the
    // notes, and a plain repository for the same reason (ADR 0014).
    attachments: connection.repositories.attachments,
    // What was done, and the catalogue that names it — the same read-then-write
    // shape as the notes, and a plain repository for the same reason (ADR 0014).
    treatmentRecords,
    treatments,
    // The patient's plans, read-only here: a record may name the planned item it
    // fulfils, and the write resolves that item on the patient's own plan before it
    // inserts. Linking is provenance — it does not complete the item, so this door
    // never reaches the plan's write side.
    treatmentPlans,
    // What the patient was sent home with — the same read-then-write shape as the
    // notes, and a plain repository for the same reason (ADR 0014).
    prescriptions,
    // The bill this visit has grown — the first billing row with a clinic_id of its
    // own. Still a plain repository, because raising a charge writes one row and the
    // use case reads the visit in this clinic first (ADR 0014).
    charges: connection.repositories.charges,
    // Money received against that bill. The write is not a plain repository: a
    // settlement raises an invoice, records the payment, allocates it and stamps the
    // charges — four rows that must become one, so it goes through the unit of work
    // the bridge uses. The register read is the one four-table join in the visits
    // feature, scoped by the visit.
    payments: connection.repositories.payments,
    // The clinic's own record, whose currency a charge is priced in: the write is
    // not complete until the currency is known, and nothing in the request or the
    // visit can say what it is. The same instance the agenda and opening hours use.
    clinics,
    // The two resources a walk-in names, because it has no booking to read them from.
    // The same instances the agenda's filters and the booking rule use: one question,
    // one implementation.
    dentists,
    chairs,
    clock: systemClock,
    ids: uuidGenerator,
  });

  // The invoice read side — the documents a settlement or an explicit billing pass
  // raises, and what the patient owes across them. Its own address, because an
  // invoice is a resource with a life of its own: `GET /invoices/:id` opens one, and
  // the patient's list and balance hang off the patient the way the plans and the
  // profile do. Given the same repository instances the visit settlement writes
  // through, so a document is raised and read through one door (ADR 0014).
  await registerInvoiceRoutes(app, {
    invoices: connection.repositories.invoices,
    payments: connection.repositories.payments,
    clinics: connection.repositories.clinics,
    unitOfWork: connection.unitOfWork,
    clock: systemClock,
    ids: uuidGenerator,
  });

  // The clinic-wide payment ledger. A read of the same rows the visit register
  // writes, scoped to a period and joined to the patient's name so the manager's
  // page is one request. Recording money stays on the visit (see the route note).
  await registerPaymentsRoutes(app, {
    payments: connection.repositories.payments,
    clinics: connection.repositories.clinics,
  });

  app.get('/', { config: { public: true } }, async () => ({
    service: 'denti-code-u3-api',
    docs: '/api/v1 (arriving with the first milestone that needs it)',
  }));

  app.addHook('onClose', async () => {
    await connection.close();
  });

  return app;
}
