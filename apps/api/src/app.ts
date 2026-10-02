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
  createDatabaseConnection,
  type DatabaseConnection,
} from './infrastructure/persistence/postgres/connection.js';
import { registerCors } from './http/plugins/cors.js';
import { registerHealthRoutes } from './http/routes/health.js';
import { registerDashboardRoutes } from './http/routes/dashboard.js';
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
  const connection = createDatabaseConnection(config.databaseUrl);

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
  await registerDashboardRoutes(app, { connection });

  app.get('/', async () => ({
    service: 'denti-code-u3-api',
    docs: '/api/v1 (arriving with the first milestone that needs it)',
  }));

  app.addHook('onClose', async () => {
    await connection.close();
  });

  return app;
}
