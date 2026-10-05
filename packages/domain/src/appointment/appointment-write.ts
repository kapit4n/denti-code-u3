/**
 * The dependencies of the appointment write use cases.
 *
 * Grouped into one interface because every one of the three use cases needs all
 * four, and three interfaces with a different combination each would be three
 * names for the same thing. A caller wires one object; the domain still cannot
 * reach a database, because everything it can reach is named here.
 *
 * `findById` and `findOverlapping` are reads, `write` is the mutation, and the
 * split is deliberate: `findOverlapping` exists *only* to feed the conflict
 * check, and it must not filter by the dentist or chair it is about to collide
 * with. That is why it takes a bare `AppointmentWindow` and not the agenda's
 * filterable one.
 */
import type {
  AppointmentId,
  ChairId,
  ClinicId,
  DentistId,
  IsoDateTime,
  PatientId,
} from '@denti-code-u3/types';
import { DomainError, notFound } from '../shared/errors.js';
import { assertWithinOperatingHours } from '../organization/clinic.js';
import type { Clinic } from '../organization/index.js';
import type {
  AppointmentRepository,
  AppointmentWriteRepository,
  ClinicRepository,
} from '../ports/index.js';
import type { AgendaEntry } from './agenda-read-model.js';
import {
  MAXIMUM_APPOINTMENT_MINUTES,
  MINIMUM_APPOINTMENT_MINUTES,
  appointmentEndsAt,
  isValidAppointmentDuration,
  type Appointment,
} from './appointment.js';
import type { AppointmentStatus } from './appointment-status.js';
import {
  assertAppointmentTransition,
  isScheduleEditable,
  requiresTransitionReason,
  reservesSchedulingSlot,
} from './appointment-lifecycle.js';
import { assertNoSchedulingConflicts } from './scheduling-conflicts.js';

export interface AppointmentWriteDependencies {
  readonly appointments: AppointmentWriteRepository & AppointmentRepository;
  readonly clinics: ClinicRepository;
  readonly newId: () => AppointmentId;
}

/** What a caller asks to book. Times are instants, never local date-times. */
export interface NewAppointmentRequest {
  readonly patientId: PatientId;
  readonly dentistId: DentistId;
  readonly chairId?: ChairId;
  readonly startsAt: IsoDateTime;
  readonly durationMinutes: number;
  readonly notes?: string;
}

/** What a caller asks to change about the time of a booked appointment. */
export interface AppointmentRescheduleRequest {
  readonly startsAt: IsoDateTime;
  readonly durationMinutes?: number;
  readonly dentistId?: DentistId;
  readonly chairId?: ChairId;
}

/** What a caller asks to happen to an appointment's status. */
export interface AppointmentTransitionRequest {
  readonly to: AppointmentStatus;
  readonly reason?: string;
}

/**
 * Books an appointment.
 *
 * The rules, in the order they are checked, and the reason for that order:
 *
 *  1. **The duration** is a whole number of minutes within the clinic's accepted
 *     range. First, because a duration that cannot be expressed cannot be checked
 *     against anything else — the end time is derived from it.
 *  2. **Opening hours.** Before the conflict check, because "the clinic is shut"
 *     is a truer answer than "that slot is taken" for a 22:00 request, and it is
 *     the one a receptionist can act on without changing the booking.
 *  3. **Conflicts**, for the same dentist or chair.
 *
 * A new appointment is always `SCHEDULED`. Confirming means the patient agreed,
 * and a create form that can do that would be recording an agreement nobody had.
 *
 * The conflict check is a courtesy, not the guarantee: the exclusion constraints
 * are, and the repository translates their refusal into the same
 * `SCHEDULING_CONFLICT` (ADR 0018). Two receptionists pressing "save" on the same
 * slot both get past step 3, and one of them is refused by the database.
 */
export async function createAppointment(
  clinicId: ClinicId,
  request: NewAppointmentRequest,
  dependencies: AppointmentWriteDependencies,
): Promise<AgendaEntry> {
  assertBookableDuration(request.durationMinutes);

  const clinic = await requireClinic(dependencies, clinicId);
  assertWithinOperatingHours(
    clinic,
    new Date(request.startsAt),
    new Date(appointmentEndsAt(request.startsAt, request.durationMinutes)),
  );

  const appointment: Appointment = {
    // Allocated after the two rules that need no id, so a booking refused for its
    // duration or its hours consumes no identifier. A conflict cannot get that
    // luxury: the checker excludes the candidate by its own id, so the candidate
    // has to be whole before the check, and a placeholder id would be a fiction
    // that could match a real row.
    id: dependencies.newId(),
    clinicId,
    patientId: request.patientId,
    dentistId: request.dentistId,
    ...(request.chairId ? { chairId: request.chairId } : {}),
    ...(request.notes ? { notes: request.notes } : {}),
    startsAt: request.startsAt,
    durationMinutes: request.durationMinutes,
    status: 'SCHEDULED',
  };

  assertNoSchedulingConflicts(
    appointment,
    await overlappingAppointments(dependencies, appointment),
  );

  return entryFor(await dependencies.appointments.insert(appointment), dependencies);
}

/**
 * Moves an appointment's time, dentist or chair.
 *
 * Two rules decide whether this is allowed at all, and they are different in kind:
 *
 *  - **The schedule may only be edited while the appointment is future**
 *    (`isScheduleEditable`). Once the patient has arrived, the booked time is
 *    history, and rewriting it is falsifying the record rather than fixing it.
 *  - **The new interval must be bookable**: a valid duration, inside opening
 *    hours, and free of conflicts. All three, because moving a booking to a legal
 *    slot is exactly as much a scheduling act as making one.
 *
 * Fields the caller does not mention keep their current values, so a front desk
 * that only changes the time cannot accidentally clear the chair. A field
 * explicitly set to "no dentist" is not expressible: `dentistId` absent means
 * "leave it", because a booking with no dentist is a different state that a
 * separate decision deserves.
 *
 * The appointment's own row is excluded from the conflict check by `id`, so moving
 * an appointment to a time that touches itself is not a conflict with itself.
 */
export async function rescheduleAppointment(
  clinicId: ClinicId,
  appointmentId: AppointmentId,
  request: AppointmentRescheduleRequest,
  dependencies: AppointmentWriteDependencies,
): Promise<AgendaEntry> {
  const existing = await dependencies.appointments.findById(clinicId, appointmentId);
  if (!existing) {
    throw notFound('Appointment', appointmentId);
  }

  if (!isScheduleEditable(existing.status)) {
    throw new DomainError(
      'ILLEGAL_TRANSITION',
      `A ${existing.status} appointment can no longer be rescheduled`,
      { appointmentId, status: existing.status },
    );
  }

  const durationMinutes = request.durationMinutes ?? existing.durationMinutes;
  assertBookableDuration(durationMinutes);

  const startsAt = request.startsAt;
  const clinic = await requireClinic(dependencies, clinicId);
  assertWithinOperatingHours(
    clinic,
    new Date(startsAt),
    new Date(appointmentEndsAt(startsAt, durationMinutes)),
  );

  const dentistId = request.dentistId ?? existing.dentistId;
  const chairId = request.chairId ?? existing.chairId;
  const moved: Appointment = {
    ...existing,
    dentistId,
    startsAt,
    durationMinutes,
    ...(chairId ? { chairId } : {}),
  };

  assertNoSchedulingConflicts(moved, await overlappingAppointments(dependencies, moved));

  const saved = await dependencies.appointments.replaceSchedule(moved);
  if (!saved) {
    // The row was there a moment ago and is not any more: deleted underneath us.
    // Not a 500, and not a silent success — the caller's screen is now wrong.
    throw notFound('Appointment', appointmentId);
  }

  return entryFor(saved, dependencies);
}

/**
 * Moves an appointment to a new status, recording why when it was cancelled.
 *
 * The subtlety is that a status is not only a label. `CANCELLED` and `NO_SHOW`
 * release the slot they were holding, so moving *into* one frees a chair, while
 * moving back *out* of one takes it again — and a slot that was free for both
 * receptionists while it was cancelled can be contested by both of them the
 * moment one presses undo.
 *
 * So a transition into a status that reserves a slot is also a scheduling act and
 * goes through the same conflict check as a reschedule. Skipping that is how a
 * calendar ends up with two appointments in chair 2 at 10:00 and no error anywhere
 * in the log: the domain check passed (there was nothing to conflict with), and
 * the database's check was never reached because nothing tried to insert.
 *
 * `reason` is required for a cancellation. "Cancelled" without a reason is a gap
 * in the record — a patient who no-showed and a clinic whose compressor failed are
 * both cancellations, and the front desk tells them apart when someone calls.
 */
export async function transitionAppointmentStatus(
  clinicId: ClinicId,
  appointmentId: AppointmentId,
  request: AppointmentTransitionRequest,
  dependencies: AppointmentWriteDependencies,
): Promise<AgendaEntry> {
  const existing = await dependencies.appointments.findById(clinicId, appointmentId);
  if (!existing) {
    throw notFound('Appointment', appointmentId);
  }

  assertAppointmentTransition(existing.status, request.to);

  if (requiresTransitionReason(request.to) && !request.reason) {
    throw new DomainError('INVALID_INPUT', 'A cancellation must say why', {
      appointmentId,
      status: existing.status,
    });
  }

  if (reservesSchedulingSlot(request.to)) {
    // Re-entering a status that holds a slot: the slot has to be free.
    const candidate: Appointment = { ...existing, status: request.to };
    assertNoSchedulingConflicts(candidate, await overlappingAppointments(dependencies, candidate));
  }

  const saved = await dependencies.appointments.changeStatus(
    clinicId,
    appointmentId,
    request.to,
    request.reason,
  );
  if (!saved) {
    throw notFound('Appointment', appointmentId);
  }

  return entryFor(saved, dependencies);
}

/**
 * The appointments whose extent could overlap `candidate`.
 *
 * The window is the candidate's own extent, padded by nothing: a conflict can
 * only exist inside it. Widening the window would be a guess about a receptionist
 * looking for slack, and it is the one thing a conflict check must not do — see
 * the note on `AppointmentWindow`.
 */
async function overlappingAppointments(
  dependencies: AppointmentWriteDependencies,
  candidate: Appointment,
): Promise<readonly Appointment[]> {
  return dependencies.appointments.findOverlapping(candidate.clinicId, {
    from: candidate.startsAt,
    to: appointmentEndsAt(candidate.startsAt, candidate.durationMinutes),
  });
}

/**
 * The clinic whose opening hours apply.
 *
 * `clinicId` is a parameter of every use case and is never read from the request
 * body. A booking states *when* and *for whom*; which clinic's book it lands in is
 * the caller's context, and a body that could set it would let any request write
 * into any clinic (ADR 0014).
 *
 * Its absence is a `NOT_FOUND` rather than a default. A request scoped to a clinic
 * that no longer exists has nothing to say about opening hours, and quietly
 * falling back to another clinic's hours would book into a book nobody asked for.
 */
async function requireClinic(
  dependencies: AppointmentWriteDependencies,
  clinicId: ClinicId,
): Promise<Clinic> {
  const clinic = await dependencies.clinics.findById(clinicId);
  if (!clinic) {
    throw notFound('Clinic', clinicId);
  }
  return clinic;
}

function assertBookableDuration(durationMinutes: number): void {
  if (!isValidAppointmentDuration(durationMinutes)) {
    throw new DomainError(
      'INVALID_INPUT',
      `An appointment must last between ${MINIMUM_APPOINTMENT_MINUTES} and ${MAXIMUM_APPOINTMENT_MINUTES} minutes`,
      { durationMinutes },
    );
  }
}

/**
 * One appointment as the agenda sees it.
 *
 * Read through the same join `findAgenda` uses rather than from the entity the
 * write constructed, so the row a write returns is the row a read would return —
 * including the patient name and the computed end time, which the entity does not
 * have. The window is not involved: a row is found by its id, and guessing a
 * window from an instant the caller may have just changed is how an appointment
 * gets written and then reported as missing.
 */
async function readEntry(
  dependencies: AppointmentWriteDependencies,
  clinicId: ClinicId,
  appointmentId: AppointmentId,
): Promise<AgendaEntry | undefined> {
  return dependencies.appointments.findEntryById(clinicId, appointmentId);
}

/**
 * Read the saved appointment back as the row the agenda will show.
 *
 * Every write answers with the read model, not with the entity it happened to
 * construct. That is the whole point: a client that splices this into its cache
 * cannot introduce a patient name or an end time of its own devising, and the
 * grid after a drag is the grid the database holds (ADR 0011).
 *
 * `undefined` here is unreachable — every write above either returned an
 * appointment or threw — and it is checked anyway, because a repository that
 * answered a write with nothing is a bug, and a `TypeError` three frames deep is a
 * worse report than a named error.
 */
async function entryFor(
  saved: Appointment,
  dependencies: AppointmentWriteDependencies,
): Promise<AgendaEntry> {
  const entry = await readEntry(dependencies, saved.clinicId, saved.id);
  if (!entry) {
    throw new DomainError(
      'INVALID_INPUT',
      'The appointment was written but could not be read back',
      { appointmentId: saved.id },
    );
  }
  return entry;
}
