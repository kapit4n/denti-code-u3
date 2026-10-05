/**
 * Schemas for the clinic's own records: the dentists and chairs a booking is made
 * against.
 *
 * They live beside the patient and appointment schemas rather than inside them
 * because a dentist is neither a patient nor an appointment, and because these two
 * lists are what an appointment is *made with* — the prerequisite the write endpoints
 * assume and that no endpoint could answer until now.
 */

import { z } from 'zod';

/**
 * `?onlyActive=true` / `?onlyActive=false`.
 *
 * A string in, a boolean out, and **absent means no filter**. That default is the
 * same one the patient list uses, and for the same reason: a resource deactivated
 * yesterday still appears on appointments booked while it was working, so a list
 * that hid it by default would leave the agenda naming nobody. Callers that want
 * only the bookable ones ask for them.
 *
 * An unrecognised value is a 422 rather than a shrug, which is what the appointments
 * route does with its window and what this one does too: `?onlyActive=yes` is a
 * client bug, and treating it as "false" would quietly return everything the caller
 * believed it had excluded.
 */
const onlyActiveQuerySchema = z.object({
  onlyActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/**
 * Separate exports, not one shared name.
 *
 * Each is one endpoint's contract, and they are free to diverge: a chair list will
 * grow a `roomId` filter long before the dentist list needs anything. Sharing the
 * export would make that change a breaking edit to both.
 */
export const dentistListQuerySchema = onlyActiveQuerySchema;
export const chairListQuerySchema = onlyActiveQuerySchema;

export type DentistListQuery = z.infer<typeof dentistListQuerySchema>;
export type ChairListQuery = z.infer<typeof chairListQuerySchema>;
