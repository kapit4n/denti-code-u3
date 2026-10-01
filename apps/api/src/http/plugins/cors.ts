import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../../config/env.js';

/**
 * CORS is restricted to the configured origins. Credentials are enabled because
 * the desktop shell authenticates with a cookie when it runs against a remote
 * API; a wildcard origin with credentials is rejected by browsers and would be
 * a security hole anyway.
 */
export async function registerCors(app: FastifyInstance, config: ApiConfig): Promise<void> {
  await app.register(cors, {
    origin: [...config.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
}
