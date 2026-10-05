/**
 * `GET /api/v1/clinic` — the clinic the app is looking at.
 *
 * One read, and it exists for a specific reason: **the browser has to know the
 * clinic's timezone and opening hours.** A calendar that renders 09:00 in the
 * visitor's own timezone shows a Lima clinic the wrong day, and the API — which
 * resolves "today" against `time_zone` — would then be answering a question about a
 * different day than the one on screen.
 *
 * So the clinic's own record is the source, not a `VITE_`-injected constant. A
 * build-time variable cannot be right for two clinics served by one API, which is
 * exactly the mistake the API's own `CLINIC_TIME_ZONE` fallback documents.
 */

import type { FastifyInstance } from 'fastify';

import type { ClinicRepository } from '@denti-code-u3/domain';
import type { ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface ClinicDependencies {
  readonly clinics: ClinicRepository;
}

export async function registerClinicRoutes(
  app: FastifyInstance,
  { clinics }: ClinicDependencies,
): Promise<void> {
  /**
   * Returns the domain `Clinic` as it is: the timezone, the currency, and the
   * opening hours the calendar shades as non-working. `settings` is an empty record
   * until the column exists, which is honest — better than a guess at its shape.
   */
  app.get('/api/v1/clinic', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const clinic = await clinics.findById(clinicId);

      // A clinic id that matches nothing is this deployment's misconfiguration,
      // not the caller's mistake: 404 would blame the browser for an environment
      // variable pointing at a deleted row. The id goes in the server log; the
      // client gets the generic 500 and a request id.
      if (!clinic) {
        request.log.error(
          { clinicId },
          'No clinic row matches the clinic this request is scoped to',
        );
        return sendProblem(
          reply,
          request,
          new Error(`No clinic row for id ${clinicId}`),
          'Failed to read the clinic',
        );
      }

      return clinic;
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the clinic');
    }
  });
}
