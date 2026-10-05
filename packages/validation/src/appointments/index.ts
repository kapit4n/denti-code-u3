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
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type TransitionAppointmentInput = z.infer<typeof transitionAppointmentSchema>;
export type AgendaRangeQuery = z.infer<typeof agendaRangeQuerySchema>;
