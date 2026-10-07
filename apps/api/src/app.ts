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
import { registerClinicScope } from './http/plugins/clinic-scope.js';
import { registerHealthRoutes } from './http/routes/health.js';
import { registerDashboardRoutes } from './http/routes/dashboard.js';
import { registerAppointmentsRoutes } from './http/routes/appointments.js';
import { registerClinicRoutes } from './http/routes/clinic.js';
import { registerDentistsRoutes } from './http/routes/dentists.js';
import { registerChairsRoutes } from './http/routes/chairs.js';
import { registerVisitsRoutes } from './http/routes/visits.js';
import { registerPatientsRoutes } from './http/routes/patients.js';
import { systemClock } from './infrastructure/clock/system-clock.js';
import { uuidGenerator } from './infrastructure/id/uuid-generator.js';
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

  // Registered before every clinical route: `request.clinicId` is what makes
  // ADR 0014's scoping rule enforceable rather than aspirational.
  await registerClinicScope(app, { config });

  // Every reader and writer shares one repository per port, so "today" and "the
  // book" each have one implementation — the connection builds them once, behind
  // whichever engine answered. Two instances of one repository would be two
  // answers to one question.
  const { appointments, clinics, dentists, chairs } = connection.repositories;

  await registerDashboardRoutes(app, {
    // The dashboard's aggregates answer through the connection's read store;
    // "today's book" is still the agenda query the calendar uses.
    dashboard: connection.dashboard,
    appointments,
  });
  // One repository for the whole patient feature: the handlers get a port, so a
  // route cannot forget the clinic filter, and adding a read does not require
  // handing out the connection again.
  await registerPatientsRoutes(app, {
    patients: connection.repositories.patients,
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
    // The two resources a walk-in names, because it has no booking to read them from.
    // The same instances the agenda's filters and the booking rule use: one question,
    // one implementation.
    dentists,
    chairs,
    clock: systemClock,
    ids: uuidGenerator,
  });

  app.get('/', async () => ({
    service: 'denti-code-u3-api',
    docs: '/api/v1 (arriving with the first milestone that needs it)',
  }));

  app.addHook('onClose', async () => {
    await connection.close();
  });

  return app;
}
