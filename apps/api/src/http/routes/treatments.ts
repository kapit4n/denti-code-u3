/**
 * The treatment catalogue: what this clinic offers, and the one way it grows.
 *
 * The read — `GET /api/v1/treatments` — is the counterpart to `/api/v1/chairs`:
 * recording a treatment on a visit names a catalogue entry, and the picker had to
 * learn which ones exist from somewhere. Each item returns the columns a picker
 * needs — name, description, duration and base price — so a visit record can be
 * written against a row the client has actually seen.
 *
 * Like the chair list this is a read with no rule attached. `isActive` is returned as
 * a fact; nothing in this product decides what may still be performed yet.
 *
 * The write — `POST /api/v1/treatments` — is the catalogue's only door, and a clinic
 * administration act: the row carries its own `clinic_id` (the tenant is the
 * request scope), the id and the clock belong to the server, and a duplicate code is
 * refused by the database's unique index and answered as a 409. A body that cannot
 * name the treatment is refused by the endpoint schema before the domain is asked.
 *
 * **Deliberately a catalogue, not a search.** No `?q=` and no paging, because "which
 * treatments does this clinic offer" is a question with a small answer that changes
 * rarely, and a picker that has to ask again per keystroke would be one whose data is
 * not in the room it is drawn in.
 */

import type { FastifyInstance } from 'fastify';

import type { IdGenerator, TreatmentRepository } from '@denti-code-u3/domain';
import { addTreatment } from '@denti-code-u3/domain';
import { createTreatmentSchema } from '@denti-code-u3/validation';
import { asTreatmentId, type ClinicId, type TreatmentId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface TreatmentsDependencies {
  readonly treatments: TreatmentRepository;
  readonly ids: IdGenerator;
}

export async function registerTreatmentsRoutes(
  app: FastifyInstance,
  { treatments, ids }: TreatmentsDependencies,
): Promise<void> {
  app.get('/api/v1/treatments', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const items = await treatments.listByClinic(clinicId);

      return { items };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to list treatments');
    }
  });

  /**
   * Add a treatment to the catalogue.
   *
   * The body is the catalogue row itself and nothing else — `clinicId` comes from
   * the request scope, never from the body, so a treatment cannot be filed under a
   * clinic the request never saw (ADR 0014). The id and the created/updated stamps
   * are the server's: what is stored is what this endpoint answers with.
   */
  app.post('/api/v1/treatments', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = createTreatmentSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The treatment could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const item = await addTreatment(clinicId, parsed.data, {
        treatments,
        newId: (): TreatmentId => asTreatmentId(ids.nextId()),
      });

      return reply.status(201).send({ item });
    } catch (error) {
      // A duplicate code arrives as a `DUPLICATED_RECORD` from the repository's
      // translation of the unique index; a blank name arrives as `INVALID_INPUT`
      // from the domain. `sendProblem` maps both to the status the caller can act
      // on, and nothing here turns the clinic's most common catalogue mistake into
      // a 500 with a request id.
      return sendProblem(reply, request, error);
    }
  });
}
