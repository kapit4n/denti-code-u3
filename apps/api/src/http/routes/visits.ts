/**
 * Starting a visit — the one door a clinical encounter comes in through.
 *
 * This route is parsing and nothing else, which is the arrangement ADR 0011 fixed for
 * the calendar and ADR 0018 for the appointment writes: the rules live in
 * `packages/domain` as use cases, so the web app, the desktop app and any future
 * client get the same answer, and what arrives here from them is a `DomainError` that
 * `sendProblem` turns into a status a person can act on.
 *
 * **The body is one field wide.** `POST /api/v1/visits` accepts an `appointmentId`
 * and nothing else about the appointment — no patient, no dentist, no chair, no time.
 * Those are read from the booking, so there is no request that can produce a visit
 * disagreeing with the appointment it came from. A body that could restate them would
 * be a body that could restate them wrongly, and the clinical record would then be
 * evidence of something that did not happen (ADR 0021).
 *
 * **No `clinicId` in the body, either.** It comes from the request scope: a client that
 * could choose its own clinic would be a cross-tenant write (ADR 0014).
 *
 * What the endpoint answers with is the visit *and* the appointment as the database now
 * holds them, because the caller almost always has both in view — the agenda is showing
 * the booking while the clinician starts the visit — and answering with only one of
 * them would leave the other to be guessed at.
 */
import type { FastifyInstance } from 'fastify';

import type { Clock, IdGenerator, UnitOfWork } from '@denti-code-u3/domain';
import { startVisit } from '@denti-code-u3/domain';
import { startVisitSchema } from '@denti-code-u3/validation';
import { asAppointmentId, asVisitId, type ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface VisitsDependencies {
  /**
   * The transaction the bridge runs in.
   *
   * Required, and there is no non-transactional alternative wired anywhere: starting a
   * visit writes two rows, and a route that could be given repositories directly would
   * be one refactor away from writing them separately (ADR 0021).
   */
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export async function registerVisitsRoutes(
  app: FastifyInstance,
  { unitOfWork, clock, ids }: VisitsDependencies,
): Promise<void> {
  /**
   * `POST /api/v1/visits` — start a visit from an appointment.
   *
   * 201 with the visit and its appointment, so a client can put both on screen without
   * guessing the visit's start time or re-fetching the booking to learn its new status.
   *
   * 409 when the appointment already has a visit, which is the one answer here that
   * arrives from the database rather than from the domain: two clinicians pressing the
   * same button at the same moment both pass the domain's check, and the unique index
   * is the only place they were ever both visible.
   */
  app.post('/api/v1/visits', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = startVisitSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The visit could not be started',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const started = await startVisit(clinicId, asAppointmentId(parsed.data.appointmentId), {
        unitOfWork,
        clock,
        newId: () => asVisitId(ids.nextId()),
      });

      return reply.status(201).send(started);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
