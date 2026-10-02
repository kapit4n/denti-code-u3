/**
 * Patient management endpoints.
 */

import type { FastifyInstance } from 'fastify';
import { sql, asc, ilike, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type DatabaseConnection } from '../../infrastructure/persistence/postgres/connection.js';
import { patients } from '@denti-code-u3/database/schema';

export interface PatientsDependencies {
  readonly connection: DatabaseConnection;
}

export async function registerPatientsRoutes(
  app: FastifyInstance,
  { connection }: PatientsDependencies,
): Promise<void> {
  const getDb = () =>
    drizzle((connection as unknown as { client: unknown }).client as never, {
      casing: 'snake_case',
    });

  app.get('/api/v1/patients', async (request, reply) => {
    const db = getDb();
    const query = request.query as { q?: string; page?: number; limit?: number };
    const q = query.q?.trim();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    try {
      const whereClause = q
        ? and(
            ilike(patients.firstName, `%${q}%`),
            ilike(patients.lastName, `%${q}%`),
          )
        : undefined;

      const baseQuery = db.select().from(patients);
      const filteredQuery = whereClause ? baseQuery.where(whereClause) : baseQuery;

      const items = await filteredQuery
        .orderBy(asc(patients.lastName), asc(patients.firstName))
        .limit(limit)
        .offset(offset);

      const countQuery = db.select({ count: sql<number>`count(*)` }).from(patients);
      const [totalResult] = whereClause
        ? await countQuery.where(whereClause)
        : await countQuery;

      return {
        items,
        total: totalResult?.count || 0,
        page,
        limit,
        totalPages: Math.ceil((totalResult?.count || 0) / limit),
      };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch patients');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch patients',
          requestId: request.id,
        },
      });
    }
  });

  app.get('/api/v1/patients/:id', async (request, reply) => {
    const db = getDb();
    const params = request.params as { id: string };

    try {
      const [patient] = await db.select().from(patients).where(sql`${patients.id} = ${params.id}`);

      if (!patient) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Patient not found',
            requestId: request.id,
          },
        });
      }

      return patient;
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch patient');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch patient',
          requestId: request.id,
        },
      });
    }
  });
}
