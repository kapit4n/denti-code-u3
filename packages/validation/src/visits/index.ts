/**
 * Visit boundary schemas.
 *
 * Two request bodies, because there are two doors and they are different requests
 * rather than two values of one field (ADR 0024):
 *
 *  - `POST /api/v1/visits` takes an `appointmentId` and nothing else about the
 *    appointment. The patient, the clinician and the chair are read from the booking
 *    rather than accepted here, because a body that could restate them is a body that
 *    could restate them *differently* — a visit whose dentist is not the one who was
 *    booked is a record of a conversation that did not happen (ADR 0021).
 *  - `POST /api/v1/visits/walk-in` takes the patient and the clinician instead,
 *    because there is no booking to read them from. That is what makes it a second
 *    schema with its own argument, and not an optional `appointmentId` (ADR 0021 §6).
 *
 * `startedAt` is absent from both from the same side: the use case reads the clock, so
 * a client cannot file a visit that started last Tuesday or next month.
 *
 * `clinicId` is absent from both because it comes from the request scope — a client
 * that could choose its own clinic would be a cross-tenant write (ADR 0014).
 */

import { z } from 'zod';

import { uuidSchema } from '../common/index.js';

/**
 * Start a visit from an appointment.
 *
 * Required and singular: an appointment becomes a visit exactly once, and the unique
 * index behind that is enforced by the database rather than by this schema, which can
 * only see one request (ADR 0021).
 */
export const startVisitSchema = z.object({
  appointmentId: uuidSchema,
});

export type StartVisitInput = z.infer<typeof startVisitSchema>;

/**
 * Start a visit for a patient who arrived without a booking.
 *
 * `dentistId` is required and not optional, which is the whole of this schema's
 * argument: a visit records treatment and treatment is attributable to a clinician, so
 * the walk-in may not be the door that skips the rule the appointment bridge keeps
 * (ADR 0021 §5, ADR 0024). `chairId` is optional for the reason it is optional on a
 * booking — the chair is chosen when one is free.
 *
 * Deliberately absent: `reason` and `summary`. The columns exist and nothing reads
 * them yet, and a field the API stores but never returns is a form answered with
 * silence (ADR 0018).
 */
export const startWalkInVisitSchema = z.object({
  patientId: uuidSchema,
  dentistId: uuidSchema,
  chairId: uuidSchema.optional(),
});

export type StartWalkInVisitInput = z.infer<typeof startWalkInVisitSchema>;

/**
 * File a clinical note on a visit.
 *
 * `body` is the whole request: who wrote it and when are facts the server owns, so
 * neither is in a body a client could send (the clock and the id generator are the use
 * case's dependencies, and `authorId` waits on a user model — ADR 0022). `visitId` is
 * the path, not the body, for the same reason the clinic is neither.
 *
 * Trimmed and then required to be non-empty: a note of nothing is not a note, and the
 * refusal belongs here so a client is told so rather than filing a row nobody can
 * read. The 2,000-character ceiling matches the appointment's `notes` field — one
 * number for "a note" in this product, rather than one per table that holds one.
 */
export const createClinicalNoteSchema = z.object({
  body: z.string().trim().min(1, 'A note needs a body').max(2_000, 'A note is too long'),
});

export type CreateClinicalNoteInput = z.infer<typeof createClinicalNoteSchema>;

/**
 * Record a treatment performed in a visit.
 *
 * `treatmentId` is required — a treatment record with no treatment is a record of
 * nothing. The 2,000-character ceiling for `notes` is the same number
 * `createClinicalNoteSchema` uses, one spelling for "a note" across the product.
 *
 * `tooth` and `notes` are trimmed and then judged by the domain: a blank tooth or note
 * is dropped to `null` there (a treatment is not necessarily on a tooth), and only the
 * *domain* can say whether digits name a real FDI tooth — its error is the one every
 * door in this product already speaks. The schema's one restraint is a ceiling on the
 * tooth's length, so a request cannot arrive with a field masquerading as a tooth.
 */
export const recordVisitTreatmentSchema = z.object({
  treatmentId: uuidSchema,
  tooth: z
    .string()
    .trim()
    .max(2, 'A tooth is an FDI number, like "36" or "75"')
    .optional()
    .nullable(),
  notes: z.string().trim().max(2_000, 'Treatment notes are too long').optional().nullable(),
});

export type RecordVisitTreatmentInput = z.infer<typeof recordVisitTreatmentSchema>;

/**
 * Deliberately not here: a `visitStatusSchema` mirroring the domain's three statuses.
 *
 * The appointment package mirrors its enum and the API has a startup check that the
 * two lists match, so the mirror cannot drift. There is no such check for visits yet,
 * and a status enum nobody has a door for would be a mirror with nothing keeping it
 * honest. It arrives with the endpoint that closes a visit, and with the check.
 */
