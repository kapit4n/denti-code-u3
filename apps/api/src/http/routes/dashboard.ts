/**
 * Dashboard statistics endpoints.
 */

import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type DatabaseConnection } from '../../infrastructure/persistence/postgres/connection.js';
import { appointments, patients } from '@denti-code-u3/database/schema';

export interface DashboardDependencies {
  readonly connection: DatabaseConnection;
}

export async function registerDashboardRoutes(
  app: FastifyInstance,
  { connection }: DashboardDependencies,
): Promise<void> {
  app.get('/api/v1/dashboard/stats', async (request, reply) => {
    const db = drizzle((connection as unknown as { client: unknown }).client as never, { casing: 'snake_case' });

    try {
      const [totalPatients] = await db
        .select({ count: sql<number>`count(*)` })
        .from(patients);

      const [todayAppointments] = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointments);

      return {
        appointments: todayAppointments?.count || 0,
        completed: 0,
        pending: 0,
        cancelled: 0,
        totalPatients: totalPatients?.count || 0,
        revenue: 0,
        pendingTreatments: 0,
        occupancyRate: 0,
      };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch dashboard stats');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch dashboard statistics',
          requestId: request.id,
        },
      });
    }
  });
}
