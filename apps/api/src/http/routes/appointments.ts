/**
 * The agenda: every appointment in a window.
 *
 * The whole endpoint is "parse the window, ask the repository, return the list".
 * It has no business rules of its own, and that is the point of ADR 0011: the
 * calendar renders what this returns and never decides what fits where.
 *
 * The window arrives as two instants and is interpreted as given. Which days a
 * user means by "this week" is a calendar-timezone question, answered in the UI
 * where the clinic's timezone is already known; the API stores UTC and says so.
 */

import type { FastifyInstance } from 'fastify';

import type { AppointmentRepository } from '@denti-code-u3/domain';
import { agendaRangeQuerySchema } from '@denti-code-u3/validation';
import { asChairId, asDentistId, type ClinicId, type IsoDateTime } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface AppointmentsDependencies {
  readonly appointments: AppointmentRepository;
}

/**
 * How far ahead one request may read.
 *
 * A clinic has years of appointments and no reason to load them; the calendar
 * asks for the range it is drawing. Unbounded, a crafted `?from=&to=` is a
 * table scan dressed as a query string.
 */
const MAX_WINDOW_DAYS = 366;

export async function registerAppointmentsRoutes(
  app: FastifyInstance,
  { appointments }: AppointmentsDependencies,
): Promise<void> {
  /**
   * `GET /api/v1/appointments?from=&to=&dentistIds=&chairIds=`
   *
   * Half-open `[from, to)`, so a caller paging through consecutive days does not
   * receive each midnight appointment twice.
   */
  app.get('/api/v1/appointments', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = agendaRangeQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The agenda window could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    const { from, to, dentistIds, chairIds } = parsed.data;
    const windowDays = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;

    if (windowDays > MAX_WINDOW_DAYS) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: `The agenda window may not span more than ${MAX_WINDOW_DAYS} days`,
          requestId: request.id,
        },
      });
    }

    try {
      const items = await appointments.findAgenda(clinicId, {
        from: from as IsoDateTime,
        to: to as IsoDateTime,
        ...(dentistIds ? { dentistIds: dentistIds.map(asDentistId) } : {}),
        ...(chairIds ? { chairIds: chairIds.map(asChairId) } : {}),
      });

      return {
        items,
        window: { from, to },
      };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the agenda');
    }
  });
}
