/**
 * Report filters.
 *
 * A report is a question about a clinic-local calendar period, so the wire carries
 * two **dates**, not two instants: `from` and `to` are inclusive clinic days. The API
 * is the only place that knows the clinic's IANA zone, and it resolves those dates to
 * the UTC half-open window the database can answer (see `clinic-time-window.ts`).
 *
 * `to` before `from` is refused here because it is a malformed question, not an empty
 * report. The maximum span is a route concern: it depends on how much a report may
 * read, not on whether the dates name a period.
 */

import { z } from 'zod';

import { isoDateSchema, uuidSchema } from '../common/index.js';

export const reportRangeQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    dentistId: uuidSchema.optional(),
  })
  .refine((range) => range.from <= range.to, {
    path: ['to'],
    message: 'The end date cannot be before the start date',
  });

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;
