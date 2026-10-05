/**
 * `GET /api/v1/chairs` — the treatment units (sillones) this clinic books into.
 *
 * The counterpart to `/api/v1/dentists`, and blocked on the same missing thing until
 * this session: a booking names a chair, and there was no way to learn which chairs
 * exist. `roomName` comes back with each one, because "Sillón 3" identifies nothing
 * in a clinic with three rooms and a receptionist has to be able to tell them apart.
 *
 * Like the dentist list this is a read with no rule attached. `isActive` is returned
 * as a fact; what a client may book is the API's business and is currently not
 * anyone's.
 */

import type { FastifyInstance } from 'fastify';

import type { ChairRepository } from '@denti-code-u3/domain';
import { chairListQuerySchema } from '@denti-code-u3/validation';
import type { ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface ChairsDependencies {
  readonly chairs: ChairRepository;
}

export async function registerChairsRoutes(
  app: FastifyInstance,
  { chairs }: ChairsDependencies,
): Promise<void> {
  app.get('/api/v1/chairs', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = chairListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The chair list query could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    const { onlyActive } = parsed.data;

    try {
      const items = await chairs.listByClinic(clinicId, {
        ...(onlyActive === undefined ? {} : { onlyActive }),
      });

      return { items };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to list chairs');
    }
  });
}
