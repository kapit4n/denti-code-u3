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
  getVisit,
  listVisitsForPatient,
  reopenVisitRecord,
  startVisit,
  type VisitRepository,
} from '@denti-code-u3/domain';
import { startVisitSchema, uuidSchema } from '@denti-code-u3/validation';
import {
  asAppointmentId,
  asPatientId,
  asVisitId,
  type ClinicId,
  type PatientId,
  type VisitId,
} from '@denti-code-u3/types';

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

  /**
   * `GET /api/v1/visits/:visitId` — one visit.
   *
   * 404 for an id this clinic does not hold, which is also the answer for an id that is
   * nowhere: `findById` cannot tell them apart and must not (ADR 0014).
   *
   * **No filterable collection.** Not `GET /visits?from=&to=&dentistIds=`, because no
   * question about visits is answered by a window and a set of filters — a visit is a
   * clinical record with no schedule (ADR 0023).
   */
  app.get('/api/v1/visits/:visitId', async (request, reply) => {
    const path = readVisitId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request);
    }

    try {
      const visit = await getVisit(path.clinicId, path.visitId, { visits });

      return reply.status(200).send(visit);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `GET /api/v1/patients/:patientId/visits` — the clinical timeline.
   *
   * Nested under the patient because a patient's history has no other sensible address:
   * the path says whose history it is without a second query field.
   *
   * **200 with `[]` for a patient who has never been treated** — and also for a patient
   * another clinic holds, because a list endpoint cannot refuse to answer "does this
   * patient exist here" without leaking "does this patient exist somewhere". It answers
   * exactly one question: which visits may I read (ADR 0014, ADR 0023).
   *
   * **Uncapped.** A silently truncated clinical timeline is worse than a long one; a
   * clinician reading "these are this patient's visits" has to be able to trust that it
   * is all of them.
   */
  app.get('/api/v1/patients/:patientId/visits', async (request, reply) => {
    const path = readPatientId(request.params, request.clinicId as ClinicId);

    if (!path.valid) {
      return sendInvalidVisitId(reply, request, 'The patient id in the path is not valid');
    }

    try {
      const list = await listVisitsForPatient(path.clinicId, path.patientId, { visits });

      return reply.status(200).send({ visits: list });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}

type ParsedPatientPath =
  | { readonly valid: true; readonly patientId: PatientId; readonly clinicId: ClinicId }
  | { readonly valid: false };

/**
 * The patient half of the timeline route, and the same guard as `readVisitId` above:
 * the clinic is the request's and the id is a uuid before either reaches a query.
 *
 * It returns its own type rather than a widened `ParsedVisitPath` with two optional ids,
 * because a path where both ids are optional would let a handler reach a query with
 * neither — and the whole point of the guard is that it cannot be reached half-parsed.
 */
function readPatientId(params: unknown, clinicId: ClinicId): ParsedPatientPath {
  const candidate = (params as { patientId?: unknown } | undefined)?.patientId;

  if (typeof candidate !== 'string' || !uuidSchema.safeParse(candidate).success) {
    return { valid: false };
  }
  return { valid: true, patientId: asPatientId(candidate), clinicId };
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
/**
 * 422 for a path id that is not a uuid.
 *
 * `message` is overridable because the timeline route's failure is about a *patient* id,
 * and "The visit id in the path is not a uuid" on `/patients/:patientId/visits` would
 * name a parameter the request does not contain. The first draft hardcoded it and the
 * mismatch was correct rather than cosmetic: a client parsing the message to find out
 * which field it got wrong would look for a field it never sent.
 */
function sendInvalidVisitId(
  reply: FastifyReply,
  request: FastifyRequest,
  message = 'The visit id in the path is not a uuid',
): FastifyReply {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details: { issues: [{ path: ['visitId'], code: 'invalid_uuid' }] },
      requestId: request.id,
    },
  });
}
