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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Clock, IdGenerator, UnitOfWork } from '@denti-code-u3/domain';
import {
  completeVisitRecord,
  reopenVisitRecord,
  startVisit,
  type VisitRepository,
} from '@denti-code-u3/domain';
import { startVisitSchema, uuidSchema } from '@denti-code-u3/validation';
import { asAppointmentId, asVisitId, type ClinicId, type VisitId } from '@denti-code-u3/types';

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

  /**
   * The plain repository the two closing endpoints use.
   *
   * A repository here and a transaction there is not an inconsistency: `startVisit`
   * writes a visit *and* an appointment, and each of these writes one row whose status
   * and end time travel in the same statement. Giving all three the same shape would
   * mean either wrapping one statement in a transaction nobody needs or, worse, handing
   * the two-row operation a plain repository and losing the guarantee that made it
   * atomic in the first place (ADR 0022).
   */
  readonly visits: VisitRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export async function registerVisitsRoutes(
  app: FastifyInstance,
  { unitOfWork, visits, clock, ids }: VisitsDependencies,
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

  /**
   * `POST /api/v1/visits/:visitId/complete` — the clinician finished with the patient.
   *
   * 200 with the visit as it now stands, including the end time the clock produced. The
   * body is empty in both directions: nothing about the visit is the caller's to say,
   * and the end time is a fact the server is the only party that can know.
   *
   * **A second endpoint rather than a status body**, because completing and reopening
   * are not two values of one field — completing sets `endedAt` and reopening clears it
   * — and because a single `POST /visits/:id/status` would also accept `CANCELLED`, whose
   * rule exists in the transition table with no use case and no door behind it
   * (ADR 0022).
   *
   * **The appointment is not touched.** The booking is completed through its own
   * endpoint, and until the front desk does that the agenda still reads `IN_TREATMENT`.
   * That is a decision with a price, and the test in `visits.integration.test.ts` says
   * so beside the assertion.
   */
  app.post('/api/v1/visits/:visitId/complete', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const completed = await completeVisitRecord(path.clinicId, path.visitId, {
        visits,
        clock,
      });

      return reply.status(200).send(completed);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/visits/:visitId/reopen` — amend a closed visit.
   *
   * 200 with the visit as it now stands: open again, and with no end time, because a
   * status and an end time that disagree would tell the patient profile two stories
   * about the same row.
   *
   * **Nothing records that this happened** beyond the row's `updated_at`, and that is
   * deliberate rather than an omission to be fixed quietly: an audit trail records who,
   * and there is no user model to record. The roadmap's "(audited)" is deferred with the
   * open question that says what would be needed (ADR 0022).
   */
  app.post('/api/v1/visits/:visitId/reopen', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const reopened = await reopenVisitRecord(path.clinicId, path.visitId, { visits, clock });

      return reply.status(200).send(reopened);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}

type ParsedVisitPath =
  | { readonly valid: true; readonly visitId: VisitId; readonly clinicId: ClinicId }
  | { readonly valid: false };

/**
 * The clinic comes from the request scope and never from the path or the body, so it is
 * read here and handed on branded: a path that has not been through this guard cannot
 * reach a query (ADR 0014).
 *
 * The id is validated with the same `uuidSchema` the appointments route uses, so a
 * hand-typed id in the URL is a 422 rather than PostgreSQL's `22P02` arriving as a 500.
 *
 * **`clinicId` is a required parameter, and the first version of this helper defaulted it
 * to an empty string.** Both handlers called it with the path alone, so every completion
 * looked for a visit in the empty clinic: `clinic_id = ''` is not a uuid, and the
 * `22P02` arrived as a **500** — the precise failure the `uuidSchema` guard one line
 * above exists to prevent, written by the guard's own author. An empty-string default for
 * a brand that means "a clinic somebody named" is a hole with a lid on it.
 */
function readVisitId(params: unknown, clinicId: ClinicId): ParsedVisitPath {
  const candidate = (params as { visitId?: unknown } | undefined)?.visitId;

  if (typeof candidate !== 'string' || !uuidSchema.safeParse(candidate).success) {
    return { valid: false };
  }
  return { valid: true, visitId: asVisitId(candidate), clinicId };
}

/** 422 for an unreadable path id, matching the body-validation shape. */
function sendInvalidVisitId(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The visit id in the path is not a uuid',
      details: { issues: [{ path: ['visitId'], code: 'invalid_uuid' }] },
      requestId: request.id,
    },
  });
}
