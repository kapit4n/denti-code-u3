/**
 * Dashboard statistics endpoints.
 */

import type { FastifyInstance } from 'fastify';
import { sql, eq, and, gte, lt, desc, asc } from 'drizzle-orm';
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
  const getDb = () =>
    drizzle((connection as unknown as { client: unknown }).client as never, {
      casing: 'snake_case',
    });

  app.get('/api/v1/dashboard/stats', async (request, reply) => {
    const db = getDb();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    try {
      const [totalPatients] = await db.select({ count: sql<number>`count(*)` }).from(patients);

      const [todayAppointments] = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(
          and(gte(appointments.startsAt, startOfDay), lt(appointments.startsAt, endOfDay)),
        );

      const [completedToday] = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(
          and(
            gte(appointments.startsAt, startOfDay),
            lt(appointments.startsAt, endOfDay),
            eq(appointments.status, 'COMPLETED'),
          ),
        );

      const [pendingToday] = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(
          and(
            gte(appointments.startsAt, startOfDay),
            lt(appointments.startsAt, endOfDay),
            eq(appointments.status, 'SCHEDULED'),
          ),
        );

      const [cancelledToday] = await db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(
          and(
            gte(appointments.startsAt, startOfDay),
            lt(appointments.startsAt, endOfDay),
            eq(appointments.status, 'CANCELLED'),
          ),
        );

      const [revenueThisMonth] = await db
        .select({ sum: sql<number>`coalesce(sum(total), 0)` })
        .from(appointments)
        .where(
          and(
            gte(appointments.startsAt, startOfMonth),
            lt(appointments.startsAt, endOfMonth),
            eq(appointments.status, 'COMPLETED'),
          ),
        );

      return {
        appointments: todayAppointments?.count || 0,
        completed: completedToday?.count || 0,
        pending: pendingToday?.count || 0,
        cancelled: cancelledToday?.count || 0,
        totalPatients: totalPatients?.count || 0,
        revenue: revenueThisMonth?.sum || 0,
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

  app.get('/api/v1/dashboard/today-appointments', async (request, reply) => {
    const db = getDb();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    try {
      const items = await db
        .select({
          id: appointments.id,
          patientId: appointments.patientId,
          startsAt: appointments.startsAt,
          status: appointments.status,
        })
        .from(appointments)
        .where(and(gte(appointments.startsAt, startOfDay), lt(appointments.startsAt, endOfDay)))
        .orderBy(asc(appointments.startsAt));

      return { items };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch today appointments');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch today appointments',
          requestId: request.id,
        },
      });
    }
  });

  app.get('/api/v1/dashboard/recent-patients', async (request, reply) => {
    const db = getDb();

    try {
      const items = await db
        .select({
          id: patients.id,
          firstName: patients.firstName,
          lastName: patients.lastName,
          createdAt: patients.createdAt,
        })
        .from(patients)
        .orderBy(desc(patients.createdAt))
        .limit(5);

      return { items };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch recent patients');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch recent patients',
          requestId: request.id,
        },
      });
    }
  });

  app.get('/api/v1/dashboard/upcoming-visits', async (request, reply) => {
    const db = getDb();
    const now = new Date();

    try {
      const items = await db
        .select({
          id: appointments.id,
          patientId: appointments.patientId,
          startsAt: appointments.startsAt,
          status: appointments.status,
        })
        .from(appointments)
        .where(gte(appointments.startsAt, now))
        .orderBy(asc(appointments.startsAt))
        .limit(5);

      return { items };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch upcoming visits');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch upcoming visits',
          requestId: request.id,
        },
      });
    }
  });
}
