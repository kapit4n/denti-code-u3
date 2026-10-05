/**
 * Visit boundary schemas.
 *
 * One request body, and it is one field wide on purpose: `POST /api/v1/visits` takes an
 * `appointmentId` and nothing else about the appointment. The patient, the clinician
 * and the chair are read from the booking rather than accepted here, because a body
 * that could restate them is a body that could restate them *differently* — a visit
 * whose dentist is not the one who was booked is a record of a conversation that did
 * not happen (ADR 0021).
 *
 * `startedAt` is absent for the same reason from the other side: the use case reads
 * the clock, so a client cannot file a visit that started last Tuesday or next month.
 *
 * A walk-in — a patient who arrives with no appointment — is a real case and is not
 * here yet. Its body would name a patient and a clinician instead of a booking, which
 * makes it a genuinely different request rather than an optional field, and the rules
 * about what a walk-in may omit deserve their own argument before they become a schema
 * (ADR 0021).
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
 * Deliberately not here: a `visitStatusSchema` mirroring the domain's three statuses.
 *
 * The appointment package mirrors its enum and the API has a startup check that the
 * two lists match, so the mirror cannot drift. There is no such check for visits yet,
 * and a status enum nobody has a door for would be a mirror with nothing keeping it
 * honest. It arrives with the endpoint that closes a visit, and with the check.
 */
