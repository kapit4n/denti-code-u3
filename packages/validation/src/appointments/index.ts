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
 * The appointment row as a response shape.
 *
 * Not used by any endpoint, and it says `dentistId` is required when the column
 * is `on delete set null`. It was here before the agenda existed, as the shape an
 * agenda endpoint was expected to return; `AgendaEntry` in the domain replaced that
 * role, and this stays only as the entity's validation rules until the write side
 * has a use for it. Delete it then.
 */
export const appointmentSchema = z.object({
  id: uuidSchema,
  clinicId: uuidSchema,
  patientId: uuidSchema,
  dentistId: uuidSchema,
  roomId: uuidSchema.nullish(),
  chairId: uuidSchema.nullish(),
  startsAt: isoDateTimeSchema,
  durationMinutes: z.int().min(5).max(480),
  status: appointmentStatusSchema,
  treatmentId: uuidSchema.nullish(),
  visitId: uuidSchema.nullish(),
  notes: z.string().max(2_000).nullish(),
  cancelledReason: z.string().max(500).nullish(),
});

export const createAppointmentSchema = z.object({
  patientId: uuidSchema,
  dentistId: uuidSchema,
  chairId: uuidSchema.optional(),
  roomId: uuidSchema.optional(),
  startsAt: isoDateTimeSchema,
  durationMinutes: z.int().min(5).max(480),
  treatmentId: uuidSchema.optional(),
  notes: z.string().max(2_000).optional(),
});

export const rescheduleAppointmentSchema = z.object({
  startsAt: isoDateTimeSchema,
  durationMinutes: z.int().min(5).max(480).optional(),
  dentistId: uuidSchema.optional(),
  chairId: uuidSchema.optional(),
});

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

export type AppointmentDto = z.infer<typeof appointmentSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type TransitionAppointmentInput = z.infer<typeof transitionAppointmentSchema>;
export type AgendaRangeQuery = z.infer<typeof agendaRangeQuerySchema>;
