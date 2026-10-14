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

import { odontogramSurfaceSchema } from '../odontogram/index.js';
import { uuidSchema } from '../common/index.js';

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

/**
 * Treatment-plan boundary schemas.
 *
 * `POST /api/v1/patients/:patientId/treatment-plans` proposes a plan and
 * `PATCH /api/v1/patients/:patientId/treatment-plans/:planId` moves it along. The
 * subject — the patient — is on the path and never in the body (the odontogram's
 * rule, ADR 0014): a client that could name its own patient could file a plan under
 * someone this request never saw. The plan id, the clock and the status's opening
 * value (`DRAFT`) belong to the server too; the status the update accepts is the
 * domain enum's values, `PROPOSED` among them, mirrored here the same way the
 * odontogram's condition and surface lists are (ADR 0011).
 *
 * A plan item names a treatment, a tooth and surfaces. The tooth is FDI and the
 * surfaces are the **odontogram's own enum** — the same `MESIAL`/`DISTAL`/… set the
 * chart stores — because a plan's line and a chart's finding describe the same teeth
 * and a second vocabulary would only let them disagree. The treatment id is optional
 * (a line may be a note to self), the price is integer minor units capped at the
 * column's range, and quantity is a whole positive count.
 */

/** FDI tooth number as text: permanent `11`–`48`, primary `51`–`85`. */
const toothNumberSchema = z
  .string()
  .trim()
  .regex(/^([1-4][1-8]|[5-8][1-5])$/, 'A tooth is an FDI number, like "36" or "75"');

/** Every status a plan may be set to, mirrored from the domain enum's values. */
const treatmentPlanStatusSchema = z.enum([
  'DRAFT',
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

/** Shape of one line of a plan, shared by any future schema that nests one. */
const treatmentPlanItemSchema = z.object({
  treatmentId: uuidSchema.optional().nullable(),
  tooth: toothNumberSchema.optional().nullable(),
  surfaces: z.array(odontogramSurfaceSchema).max(6, 'A tooth has at most six surfaces').default([]),
  quantity: z
    .number()
    .int()
    .min(1, 'Quantity must be at least 1')
    .max(100, 'Quantity is too high')
    .default(1),
  estimatedPriceMinor: z
    .number()
    .int()
    .nonnegative('Price cannot be negative')
    .max(MAX_PRICE_MINOR, 'Price is too large')
    .optional(),
  notes: z.string().trim().max(500, 'Item notes are too long').optional().nullable(),
});

/** Propose a treatment plan for the patient on the path. */
export const createTreatmentPlanSchema = z.object({
  dentistId: uuidSchema.optional().nullable(),
  title: z.string().trim().max(200, 'The title is too long').optional().nullable(),
  notes: z.string().trim().max(2_000, 'The notes are too long').optional().nullable(),
  items: z
    .array(treatmentPlanItemSchema)
    .min(1, 'A treatment plan needs at least one item')
    .max(50, 'A treatment plan is too long to save'),
});

export type CreateTreatmentPlanInput = z.infer<typeof createTreatmentPlanSchema>;

/**
 * Move a plan along: its status, its title, its notes — nothing else.
 *
 * Deliberately not `createTreatmentPlanSchema.partial()`: a plan's lines are written
 * when it is proposed, and editing them is a different operation than moving the
 * plan through its statuses. `status` is the only field with a rule worth naming, and
 * that rule (which statuses exist) is the enum above; which moves are *legal* is not
 * decided yet, so this schema does not pretend to know.
 */
export const updateTreatmentPlanSchema = z.object({
  status: treatmentPlanStatusSchema.optional(),
  title: z.string().trim().max(200, 'The title is too long').optional().nullable(),
  notes: z.string().trim().max(2_000, 'The notes are too long').optional().nullable(),
});

export type UpdateTreatmentPlanInput = z.infer<typeof updateTreatmentPlanSchema>;
