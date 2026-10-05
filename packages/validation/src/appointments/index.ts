/**
 * Appointment boundary schemas.
 *
 * Appointment statuses appear here as data, mirrored from the domain enum. They
 * are declared as literals rather than imported so that this package stays free
 * of domain dependencies; the API has a startup check that the two lists match,
 * so the mirror can never silently drift.
 */

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/index.js';

export const appointmentStatusSchema = z.enum([
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_TREATMENT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

/**
 * Booking a new appointment.
 *
 * `dentistId` is required, and that is a scheduling fact rather than a schema
 * preference: an appointment nobody is going to perform is not a booking. The
 * *entity* still allows a null dentist, because a booking outlives the dentist who
 * was going to perform it and the column is `on delete set null`.
 *
 * Two columns are deliberately absent. `treatmentId`: `appointments` has no
 * `treatment_id` column yet, and a form that sends one and is answered with
 * silence is worse than a form without the field. `roomId`: the column and its
 * exclusion constraint exist, but `AgendaEntry` does not carry the room, so a
 * booking could be assigned a room and then never shown it or moved to another
 * one. The chair is what the write side accepts, because the read model reports
 * the chair (ADR 0018).
 */
export const createAppointmentSchema = z.object({
  patientId: uuidSchema,
  dentistId: uuidSchema,
  chairId: uuidSchema.optional(),
  startsAt: isoDateTimeSchema,
  durationMinutes: z.int().min(5).max(480),
  notes: z.string().max(2_000).optional(),
});

/**
 * A field that reads an empty input as "not supplied".
 *
 * Copied from the patient schemas rather than imported: `blankIsAbsent` is three
 * lines of implementation, and sharing it would mean one of the two files importing
 * from the other, which makes the boundary schemas depend on each other's shape.
 * The comment on the patient copy explains why this is `z.union` and not
 * `z.preprocess` — the input type must survive, or React Hook Form cannot derive
 * its field values.
 */
const blankText = z
  .string()
  .trim()
  .refine((value) => value === '');

function blankIsAbsent<TField extends z.ZodType>(field: TField) {
  return z
    .union([blankText, field])
    .transform((value) => (value === '' ? undefined : value))
    .optional();
}

/**
 * A clinic wall clock, as a form receives it: `YYYY-MM-DDTHH:mm`, no offset.
 *
 * **Not `isoDateTimeSchema`, and the difference is the point.** That one insists on an
 * offset, which is right for a request and wrong for a question a person asked: nobody
 * books an appointment at "2026-09-30T14:00Z", they book it at "the 30th, at two in
 * the afternoon", and which instant that is depends entirely on the clinic's zone.
 *
 * The form therefore carries the wall clock and the app converts it with the zone the
 * clinic record reported — see `zoned-wall-clock.ts` in the app, which is the only
 * place that conversion happens. An instant built from the *machine's* zone is the bug
 * this field exists to make impossible.
 */
export const zonedWallClockSchema = z.string().superRefine((value, ctx) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);

  // One check rather than a regex plus a refine, so one bad value produces one message:
  // two errors on one field means the dialog has to choose which one a person reads.
  if (!parts) {
    ctx.addIssue({ code: 'custom', message: 'Choose a date and time' });
    return;
  }

  // The defaults are unreachable - the pattern has exactly five groups - and harmless
  // if they ever were reached: a zero fails the round trip below and is reported as a
  // date that does not exist, rather than throwing inside a validator.
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0] = parts.slice(1).map(Number);

  // A regex cannot tell 2026-02-30 from 2026-03-02, and `Date.parse` will not either:
  // it reads the first as the second without complaint. So the parts are checked
  // against a date that claims to be them, and a claim that comes back different is
  // not a date. `Date.UTC` inverts cleanly because no real calendar is involved —
  // there is no zone here to shift an answer into a different day.
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute));

  const calendarHasThisDate =
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute;

  if (!calendarHasThisDate) {
    ctx.addIssue({ code: 'custom', message: 'That date does not exist' });
  }
});

/**
 * The booking form's view of `createAppointmentSchema`.
 *
 * Same construction as the patient forms: every field is taken from
 * `createAppointmentSchema.shape`, so the form accepts exactly what the API accepts
 * and `appointments.test.ts` asserts the correspondence still holds. A booking dialog
 * that sent a field the API refuses would be a form whose only symptom is a 422 the
 * user cannot act on.
 *
 * Three differences from the API schema, all about a form rather than a request:
 *
 *  - **`localStartsAt` instead of `startsAt`.** The form holds the wall clock the
 *    person can read, and the app turns it into the instant the API stores using the
 *    clinic's zone. The instant is therefore *not a field at all*: there is nothing
 *    hidden from the user for this schema to validate on their behalf, and no way for
 *    a default and a typed value to disagree about what was asked for. The agenda
 *    opens this same dialog with the clicked slot already in the field, read-only, so
 *    the grid is still where the time is chosen.
 *  - **Blanks mean absent.** A dialog submits `''` for a chair nobody chose and a
 *    notes field nobody typed, and the API rejects `''` for the same `min`-style
 *    reason it rejects an empty name. Without this, booking without a chair would
 *    be impossible.
 *  - **The two required pickers say what to do.** See the messages below.
 */

export const createAppointmentFormSchema = z.object({
  // Both ids are the same `uuid` the API checks; only the message differs, and it
  // differs because of who is looking at it. Zod's default for a bad uuid is "Invalid
  // uuid", which is what a receptionist would read if the dialog forgot to mark the
  // two required pickers — and "Invalid uuid" cannot be acted on. The field is a
  // choice, so the message names the choice.
  patientId: z.uuid('Choose a patient'),
  dentistId: z.uuid('Choose a clinician'),
  chairId: blankIsAbsent(createAppointmentSchema.shape.chairId),
  localStartsAt: zonedWallClockSchema,
  durationMinutes: createAppointmentSchema.shape.durationMinutes,
  notes: blankIsAbsent(createAppointmentSchema.shape.notes),
});

/**
 * Moving an appointment's time, dentist or chair.
 *
 * Every field is optional and absent means "leave it": a front desk that only
 * changes the time must not clear the chair as a side effect. Clearing the chair
 * is not expressible, which is deliberate — see `rescheduleAppointment`.
 */
export const rescheduleAppointmentSchema = z.object({
  startsAt: isoDateTimeSchema,
  durationMinutes: z.int().min(5).max(480).optional(),
  dentistId: uuidSchema.optional(),
  chairId: uuidSchema.optional(),
});

/**
 * A status change. `reason` is required by the domain for a cancellation, and is
 * not required here so that the 422 names the business rule rather than the shape.
 */
export const transitionAppointmentSchema = z.object({
  to: appointmentStatusSchema,
  reason: z.string().max(500).optional(),
});

/** A comma-separated list of UUIDs used as a multi-select filter. */
const uuidListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(uuidSchema).max(50))
  .optional();

/** Half-open agenda window: `from` inclusive, `to` exclusive. */
export const agendaRangeQuerySchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    dentistIds: uuidListSchema,
    chairIds: uuidListSchema,
  })
  .refine((value) => new Date(value.from).getTime() < new Date(value.to).getTime(), {
    message: 'The agenda window must end after it starts',
    path: ['to'],
  });

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
/**
 * What the booking dialog holds while it is open.
 *
 * A wall clock rather than an instant: see `createAppointmentFormSchema`.
 */
export type CreateAppointmentFormValues = z.input<typeof createAppointmentFormSchema>;
/**
 * What the dialog holds after validation: blanks resolved to absent.
 *
 * This is *not* the shape of the request. `startsAt` is missing, because the instant
 * only exists once the clinic's zone has been applied, and that conversion belongs to
 * the app rather than to this package — a schema cannot know the clinic's zone. The
 * mutation takes `CreateAppointmentInput`, the API's own type, so the body it sends is
 * typed as the request rather than as a form that is nearly the same thing.
 */
export type CreateAppointmentFormOutput = z.output<typeof createAppointmentFormSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type TransitionAppointmentInput = z.infer<typeof transitionAppointmentSchema>;
export type AgendaRangeQuery = z.infer<typeof agendaRangeQuerySchema>;

/**
 * One appointment that a refused write collided with.
 *
 * Mirrors the domain's `ScheduleConflict` as literals, for the same reason the status
 * list above is mirrored: this package holds no domain dependency, and a client that
 * has to read a refusal out of an error envelope needs the shape written down in one
 * place. The API's startup check covers the status list; this one is checked by its
 * own tests instead, because it is only ever read by whoever is showing the message.
 *
 * **No names.** The conflict carries ids and instants, so a client can say *when* the
 * clash is and not *who* it is with. The panel says the time and sends the user to
 * the grid, rather than inventing a patient name from a uuid.
 */
export const scheduleConflictSchema = z.object({
  appointmentId: uuidSchema,
  patientId: uuidSchema,
  /** Null once that dentist has left the clinic; the column is `on delete set null`. */
  dentistId: uuidSchema.nullable(),
  /** Absent when the conflicting appointment has no chair. */
  chairId: uuidSchema.optional(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
});

/** The `details` of a `SCHEDULING_CONFLICT` problem envelope. */
export const scheduleConflictDetailsSchema = z.object({
  conflicts: z.array(scheduleConflictSchema),
});

export type ScheduleConflictPayload = z.infer<typeof scheduleConflictSchema>;
