/**
 * Treatment-catalogue boundary schemas.
 *
 * `POST /api/v1/treatments` adds one procedure to the clinic's offer. The body is
 * the catalogue row itself and nothing else: `clinicId` comes from the request
 * scope (a client that could choose its own clinic would be a cross-tenant write,
 * ADR 0014), and the id and the clock belong to the server. The row carries its own
 * `clinic_id`, so unlike the visit books this write has no subject to inherit `who`
 * from — the clinic is the tenant and the request has already named it.
 *
 * `name` is the one field that must always be stated — it is `NOT NULL` in the
 * table and the one string a picker always has to draw. `code` is optional and
 * unique-per-clinic: a duplicate code is refused by the database's
 * `(clinic_id, code)` index and translated to `DUPLICATED_RECORD`, not by this
 * schema, which can only see one request (the same race the appointment overlap
 * refuses in the database rather than the schema). The price is integer minor
 * units capped at the column's range, the duration is whole positive minutes, and
 * blank code and description are dropped to `null` by the domain, never stored
 * empty.
 */

import { z } from 'zod';

/** The largest integer a PostgreSQL `integer` column holds, in minor units. */
const MAX_PRICE_MINOR = 2_147_483_647;

/**
 * Add a treatment to the clinic's catalogue.
 *
 * A body that cannot name the treatment is refused here with the field's own
 * sentence; rules that are business rules rather than shape rules (a price the
 * column cannot hold) stay no further than this file, and rules about how a row is
 * *built* (blank to null, defaults) live in the domain, which both the schema's
 * trims and the database's defaults answer the same way the clinic reads the row.
 */
export const createTreatmentSchema = z.object({
  /** Unique per clinic, and nullable — a catalogue may have unnamed rows. */
  code: z.string().trim().max(50, 'The code is too long').optional().nullable(),
  name: z
    .string()
    .trim()
    .min(1, 'A treatment needs a name')
    .max(200, 'The treatment name is too long'),
  description: z.string().trim().max(2_000, 'The description is too long').optional().nullable(),
  /** Estimated clinical minutes; a procedure is at most a day. */
  defaultDurationMinutes: z
    .number()
    .int()
    .min(1, 'A duration must be whole positive minutes')
    .max(1_440, 'A procedure is at most a day')
    .optional()
    .nullable(),
  /** Base price in minor units of the clinic currency, at most one column's worth. */
  defaultPriceMinor: z
    .number()
    .int()
    .nonnegative('A price cannot be negative')
    .max(MAX_PRICE_MINOR, 'The price is too large')
    .optional(),
  isActive: z.boolean().optional(),
});

export type CreateTreatmentInput = z.infer<typeof createTreatmentSchema>;
