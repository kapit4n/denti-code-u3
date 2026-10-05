/**
 * `GET /api/v1/dentists` — the clinicians this clinic can book.
 *
 * It exists for one caller and one reason: **`POST /api/v1/appointments` requires a
 * `dentistId`, and nothing could name one.** Until this endpoint existed, the only
 * way to book an appointment from the API was to already know a uuid.
 *
 * It is a read and nothing more. There is no rule here about who may be booked —
 * `isActive` is returned as a fact and the caller decides what to offer — because a
 * rule that only the browser enforced would be a rule the API does not have. See the
 * open question in `docs/open-questions.md`: whether an inactive dentist may still be
 * booked is a product decision, and this endpoint is deliberately not where it gets
 * made by omission.
 *
 * Scoping is the clinic on the request, applied inside the repository. A dentist
 * belonging to another clinic is not listed, and is not reachable by id either.
 */

import type { FastifyInstance } from 'fastify';

import type { DentistRepository } from '@denti-code-u3/domain';
import { dentistListQuerySchema } from '@denti-code-u3/validation';
import type { ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface DentistsDependencies {
  readonly dentists: DentistRepository;
}

export async function registerDentistsRoutes(
  app: FastifyInstance,
  { dentists }: DentistsDependencies,
): Promise<void> {
  app.get('/api/v1/dentists', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = dentistListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The dentist list query could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    const { onlyActive } = parsed.data;

    try {
      const items = await dentists.listByClinic(clinicId, {
        // Absent means no filter, which is `undefined` rather than `false` — the
        // repository's own truthiness check is what turns that into "every dentist".
        ...(onlyActive === undefined ? {} : { onlyActive }),
      });

      return { items };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to list dentists');
    }
  });
}
