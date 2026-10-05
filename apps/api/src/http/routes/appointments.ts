/**
 * The clinic's book: read a window of it, and write to it.
 *
 * The read endpoint is "parse the window, ask the repository, return the list". It
 * has no business rules of its own, and that is the point of ADR 0011: the
 * calendar renders what this returns and never decides what fits where.
 *
 * The window arrives as two instants and is interpreted as given. Which days a
 * user means by "this week" is a calendar-timezone question, answered in the UI
 * where the clinic's timezone is already known; the API stores UTC and says so.
 *
 * The three write endpoints are parsing and nothing else. Whether a booking may
 * happen at all, whether a time may move and whether a status may change are
 * business rules, and they live in `packages/domain` as use cases (ADR 0018), so
 * the web app, the desktop app and any future client get the same answer. What
 * arrives here from them is a `DomainError`, and `sendProblem` turns it into the
 * status the client can act on.
 *
 * Every write answers with the `AgendaEntry` the database now holds rather than
 * with the values that were sent, so a client splices the server's row into its
 * cache instead of reconstructing one — which is how a calendar ends up showing a
 * patient's name the API never returned.
 */

import type { FastifyInstance } from 'fastify';

import type {
  AppointmentRepository,
  ChairRepository,
  ClinicRepository,
  DentistRepository,
  IdGenerator,
} from '@denti-code-u3/domain';
import {
  createAppointment,
  rescheduleAppointment,
  transitionAppointmentStatus,
} from '@denti-code-u3/domain';
import {
  agendaRangeQuerySchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  transitionAppointmentSchema,
  uuidSchema,
} from '@denti-code-u3/validation';
import {
  asAppointmentId,
  asChairId,
  asDentistId,
  asPatientId,
  type AppointmentId,
  type ClinicId,
  type IsoDateTime,
} from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface AppointmentsDependencies {
  readonly appointments: AppointmentRepository;
  /**
   * For the "who may be booked" rule: a clinician or chair marked inactive cannot
   * be named by a create or a reschedule (product question 17).
   *
   * Required rather than optional because an appointment route that could be wired
   * without them is a route where that rule silently does not run — which is the bug
   * the rule was written to remove. Wiring them is one object at the call site, and
   * forgetting is a type error rather than a policy hole.
   */
  readonly dentists: DentistRepository;
  readonly chairs: ChairRepository;
  /**
   * For the opening-hours rule: the clinic's own record, not a constant.
   *
   * The hours a booking is checked against are the clinic's data, so they are read
   * and not configured here. A clinic that opens at 07:00 must not need a
   * deployment.
   */
  readonly clinics: ClinicRepository;
  readonly ids: IdGenerator;
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
  { appointments, dentists, chairs, clinics, ids }: AppointmentsDependencies,
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

  /**
   * `POST /api/v1/appointments` — book an appointment.
   *
   * `clinicId` comes from the request scope and never from the body: a client that
   * could choose its own clinic would be a cross-tenant write (ADR 0014). The same
   * applies to every reference in the body — the patient, the dentist and the chair
   * must belong to this clinic, and PostgreSQL's tenant foreign keys say so even
   * when a code path forgets to ask.
   *
   * 201 with the `AgendaEntry` the row became, so a client can put the booking on
   * the grid without guessing the end time or the patient's name.
   */
  app.post('/api/v1/appointments', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = createAppointmentSchema.safeParse(request.body);

    if (!parsed.success) {
      return sendInvalidBody(reply, request, 'The appointment could not be accepted', parsed.error);
    }

    try {
      const entry = await createAppointment(
        clinicId,
        {
          patientId: asPatientId(parsed.data.patientId),
          dentistId: asDentistId(parsed.data.dentistId),
          ...(parsed.data.chairId ? { chairId: asChairId(parsed.data.chairId) } : {}),
          startsAt: parsed.data.startsAt as IsoDateTime,
          durationMinutes: parsed.data.durationMinutes,
          ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
        },
        bookingDependencies({ appointments, dentists, chairs, clinics, ids }),
      );

      return reply.status(201).send(entry);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `PUT /api/v1/appointments/:appointmentId/schedule` — move an appointment.
   *
   * A sub-resource rather than a `PUT` on the appointment itself, because the
   * status is not part of the schedule: a body that carried both would let a
   * request that meant to move an hour also confirm the appointment, and the two
   * carry different rules.
   *
   * `PUT` rather than `PATCH`, and every field but the start is optional: absent
   * means "leave it as it is". That is the opposite of the patients' `PUT`, where
   * absent means "this patient has no email", and it is deliberate — a front desk
   * that only changes the time must not clear the chair as a side effect of a drag.
   */
  app.put('/api/v1/appointments/:appointmentId/schedule', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const path = readAppointmentId(request.params);

    if (!path.valid) {
      return sendInvalidPath(reply, request);
    }
    const { appointmentId } = path;

    const parsed = rescheduleAppointmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalidBody(
        reply,
        request,
        'The new schedule could not be accepted',
        parsed.error,
      );
    }

    try {
      const entry = await rescheduleAppointment(
        clinicId,
        appointmentId,
        {
          startsAt: parsed.data.startsAt as IsoDateTime,
          ...(parsed.data.durationMinutes !== undefined
            ? { durationMinutes: parsed.data.durationMinutes }
            : {}),
          ...(parsed.data.dentistId ? { dentistId: asDentistId(parsed.data.dentistId) } : {}),
          ...(parsed.data.chairId ? { chairId: asChairId(parsed.data.chairId) } : {}),
        },
        bookingDependencies({ appointments, dentists, chairs, clinics, ids }),
      );

      return reply.status(200).send(entry);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  /**
   * `POST /api/v1/appointments/:appointmentId/status` — move the appointment's state.
   *
   * `POST` on a sub-resource rather than `PATCH` on the appointment: a status change
   * is an action with its own rules (what it is legal from, whether the reason is
   * required, whether taking the new status re-takes a slot), not a field edit. A
   * URL that says which transition is being asked for is also a URL that can be
   * logged and audited without reading the body.
   *
   * This is where `SCHEDULED -> CANCELLED` and back live, and the second direction
   * is not merely bookkeeping: a cancelled appointment holds no chair, so putting it
   * back has to win the chair like any other booking.
   */
  app.post('/api/v1/appointments/:appointmentId/status', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const path = readAppointmentId(request.params);

    if (!path.valid) {
      return sendInvalidPath(reply, request);
    }
    const { appointmentId } = path;

    const parsed = transitionAppointmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendInvalidBody(
        reply,
        request,
        'The status change could not be accepted',
        parsed.error,
      );
    }

    try {
      const entry = await transitionAppointmentStatus(
        clinicId,
        appointmentId,
        {
          to: parsed.data.to,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        },
        // The narrow object on purpose: a status transition names no clinician and no
        // chair, so it has nothing to ask the bookable-resources rule and must not be
        // handed the repositories to ask it with.
        writeDependencies({ appointments, clinics, ids }),
      );

      return reply.status(200).send(entry);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}

/**
 * The dependencies every write use case takes, assembled here.
 *
 * Three handlers building it the same way is the point: the clinic is the request's
 * own, and the id generator is the one the whole API allocates from, so an id minted
 * for an appointment cannot collide with a record number minted for a patient.
 */
/** The four every write needs. A status transition names no resource, so it stops here. */
function writeDependencies({
  appointments,
  clinics,
  ids,
}: Pick<AppointmentsDependencies, 'appointments' | 'clinics' | 'ids'>) {
  return {
    appointments,
    clinics,
    // The one id generator the whole API allocates from, so an appointment id
    // cannot collide with a record number minted for a patient.
    newId: () => asAppointmentId(ids.nextId()),
  };
}

/** The four, plus the two that answer who may be booked — see ADR 0020. */
function bookingDependencies({
  appointments,
  dentists,
  chairs,
  clinics,
  ids,
}: AppointmentsDependencies) {
  return { ...writeDependencies({ appointments, clinics, ids }), dentists, chairs };
}

/**
 * The appointment id in the path, or a note that it is not one.
 *
 * Branded here rather than cast at each call site, so a path that has not been
 * checked cannot reach a query.
 */
function readAppointmentId(params: unknown): ParsedAppointmentPath {
  const candidate = (params as { appointmentId?: unknown } | undefined)?.appointmentId;

  if (typeof candidate !== 'string' || !uuidSchema.safeParse(candidate).success) {
    return { valid: false };
  }
  return { valid: true, appointmentId: asAppointmentId(candidate) };
}

/**
 * A discriminated union rather than a field that may be missing.
 *
 * `appointmentId?: AppointmentId` plus a boolean the caller must remember to check
 * lets a second handler skip the check and pass `undefined` into a query. Here the
 * only way to reach an `appointmentId` is to have been through the guard.
 */
type ParsedAppointmentPath =
  { readonly valid: true; readonly appointmentId: AppointmentId } | { readonly valid: false };

function sendInvalidBody(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  request: { id: string },
  message: string,
  error: { issues: unknown },
): unknown {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details: { issues: error.issues },
      requestId: request.id,
    },
  });
}

/**
 * A path that is not a UUID is a 422, not a 500.
 *
 * Cast to the branded id and handed to PostgreSQL, `not-a-uuid` would come back as
 * `22P02 invalid_text_representation` — a server error caused by a client typo, and
 * the reason a route that is careful about a *body* can still be surprised by its
 * own path.
 */
function sendInvalidPath(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  request: { id: string },
): unknown {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'That is not an appointment id',
      requestId: request.id,
    },
  });
}
