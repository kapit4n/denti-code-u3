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
 * The routes a medication can be taken by, mirrored from the domain enum's values.
 *
 * Mirrored as literals because this package holds no domain dependency, the same
 * reason appointment statuses are mirrored in this package's sibling file. The list
 * is two static copies of one clinical fact for now — `medicationRouteSchema` here
 * and `MEDICATION_ROUTES` in the domain — kept aligned the way the appointment
 * mirror is: the API's write path types its input as the domain's `MedicationRoute`,
 * so a route this side cannot spell that the domain side does not know, and the
 * database's own `enumCheck` guards the column. One value, declared in one place,
 * stays a habit this product is still forming (ADR 0011).
 */
export const medicationRouteSchema = z.enum([
  'ORAL',
  'TOPICAL',
  'INHALATION',
  'INJECTION',
  'RECTAL',
  'OTHER',
]);

/**
 * Prescribe a medication on a visit.
 *
 * `visitId` is the path rather than the body, and `issuedAt` along with the ids are
 * the server's own — the same division every write body here keeps. **Who the record
 * is about is inherited from the visit and is not in the body**: a request that could
 * state the patient or the clinician could state them *differently* from the visit
 * they are filed on (ADR 0014, ADR 0021). So the body is only the course.
 *
 * Medication, dosage and frequency are trimmed and required to be non-empty: a course
 * that does not say what to take is not an order. `instructions` is optional and
 * trimmed; a blank one is dropped to `null` by the domain, never stored empty. The
 * 200-character ceilings are one number for "a short clinical field", and the
 * 2,000-character instruction ceiling is the same number the note schemas use for a
 * sentence.
 */
export const createPrescriptionSchema = z.object({
  medication: z
    .string()
    .trim()
    .min(1, 'A medication needs a name')
    .max(200, 'The medication name is too long'),
  dosage: z
    .string()
    .trim()
    .min(1, 'A prescription needs a dosage')
    .max(200, 'The dosage is too long'),
  route: medicationRouteSchema,
  frequency: z
    .string()
    .trim()
    .min(1, 'A prescription needs a frequency')
    .max(200, 'The frequency is too long'),
  durationDays: z
    .int()
    .min(1, 'A prescription needs to last whole days')
    .max(365, 'A course is at most a year'),
  instructions: z.string().trim().max(2_000, 'The instructions are too long').optional().nullable(),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

/**
 * Deliberately not here: a `visitStatusSchema` mirroring the domain's three statuses.
 *
 * The appointment package mirrors its enum and the API has a startup check that the
 * two lists match, so the mirror cannot drift. There is no such check for visits yet,
 * and a status enum nobody has a door for would be a mirror with nothing keeping it
 * honest. It arrives with the endpoint that closes a visit, and with the check.
 */
