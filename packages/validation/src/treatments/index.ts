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



const toothNumberSchema = z.string().trim().regex(/^([1-4][1-8]|[5-8][1-5])$/, 'A tooth is an FDI number, like "36" or "75"');
const toothSurfaceSchema = z.enum(['O','M','D','B','L','V']);
const treatmentPlanStatusSchema = z.enum(['DRAFT','PRESENTED','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED']);

/** Schema for creating a treatment plan. */
export const createTreatmentPlanSchema = z.object({
  patientId: z.string().uuid('A patient id is required'),
  dentistId: z.string().uuid('A dentist id is required').optional().nullable(),
  title: z.string().trim().max(200, 'The title is too long').optional().nullable(),
  notes: z.string().trim().max(2000, 'The notes are too long').optional().nullable(),
  items: z
    .array(
      z.object({
        treatmentId: z.string().uuid('A treatment id is required').optional().nullable(),
        tooth: toothNumberSchema.optional().nullable(),
        surfaces: z.array(toothSurfaceSchema).max(5).default([]),
        quantity: z.number().int().min(1, 'Quantity must be at least 1').max(100, 'Quantity is too high').default(1),
        estimatedPriceMinor: z
          .number()
          .int()
          .nonnegative('Price cannot be negative')
          .max(2_147_483_647, 'Price is too large')
          .optional(),
        notes: z.string().trim().max(500, 'Item notes are too long').optional().nullable(),
      }),
    )
    .min(1, 'A treatment plan needs at least one item')
    .max(50, 'A treatment plan is too long to save'),
});

export const updateTreatmentPlanSchema = createTreatmentPlanSchema.partial().extend({
  status: treatmentPlanStatusSchema.optional(),
});

export const completeTreatmentPlanItemSchema = z.object({
  isCompleted: z.boolean(),
});

export type CreateTreatmentPlanInput = z.infer<typeof createTreatmentPlanSchema>;
export type UpdateTreatmentPlanInput = z.infer<typeof updateTreatmentPlanSchema>;
export type CompleteTreatmentPlanItemInput = z.infer<typeof completeTreatmentPlanItemSchema>;

export const treatmentPlanCreateSchema = z.object({
  patientId: z.string().min(1),
  dentistId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
  items: z
    .array(
      z.object({
        treatmentId: z.string().min(1).nullable().optional(),
        tooth: z.string().nullable().optional(),
        surfaces: z.array(z.string()).optional(),
        quantity: z.number().int().positive().optional(),
        estimatedPriceMinor: z.number().int().nonnegative().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export const treatmentPlanUpdateSchema = z.object({
  status: treatmentPlanStatusSchema.nullable().optional(),
  title: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
});
