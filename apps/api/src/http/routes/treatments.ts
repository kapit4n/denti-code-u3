/**
 * `GET /api/v1/treatments` — the catalogue of procedures this clinic offers.
 *
 * The counterpart to `/api/v1/chairs`, and blocked until now on the same missing
 * thing: recording a treatment on a visit names a catalogue entry, and there was no
 * way to learn which ones exist. Each item returns the columns a picker needs —
 * name, description, duration and base price — so a visit record can be written
 * against a row the client has actually seen.
 *
 * Like the chair list this is a read with no rule attached. `isActive` is returned as
 * a fact; nothing in this product decides what may still be performed yet.
 *
 * **Deliberately a catalogue, not a search.** No `?q=` and no paging, because "which
 * treatments does this clinic offer" is a question with a small answer that changes
 * rarely, and a picker that has to ask again per keystroke would be one whose data is
 * not in the room it is drawn in.
 */

import type { FastifyInstance } from 'fastify';

import type { TreatmentRepository } from '@denti-code-u3/domain';
import type { ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface TreatmentsDependencies {
  readonly treatments: TreatmentRepository;
}

export async function registerTreatmentsRoutes(
  app: FastifyInstance,
  { treatments }: TreatmentsDependencies,
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
}
