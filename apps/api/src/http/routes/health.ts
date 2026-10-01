/**
 * Liveness and readiness probes.
 *
 * `/health` answers "is this process running?" and must never touch the
 * database — an orchestrator must be able to tell a slow database apart from a
 * dead API. `/ready` answers "can this process serve traffic?" and therefore does
 * depend on the database.
 */

import type { FastifyInstance } from 'fastify';
import {
  isDatabaseReachable,
  type DatabaseConnection,
} from '../../infrastructure/persistence/postgres/connection.js';
import type { ApiConfig } from '../../config/env.js';

export interface HealthDependencies {
  readonly config: ApiConfig;
  readonly connection: DatabaseConnection;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  { config, connection }: HealthDependencies,
): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'denti-code-u3-api',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  }));

  app.get('/ready', async (_request, reply) => {
    const database = await isDatabaseReachable(connection);
    return reply.status(database ? 200 : 503).send({
      status: database ? 'ready' : 'degraded',
      checks: { database: database ? 'ok' : 'unreachable' },
    });
  });
}
