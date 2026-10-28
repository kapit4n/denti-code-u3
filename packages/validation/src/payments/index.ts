/**
 * Payment ledger filters.
 *
 * The ledger is a clinic-local calendar period, exactly like a report: the wire
 * carries two inclusive dates, and the API resolves them in the clinic's zone to the
 * half-open instant window the repository queries. `method` is the one optional
 * filter the screen offers; it is omitted when the manager asks for every method.
 */

import { z } from 'zod';

import { isoDateSchema } from '../common/index.js';
import { paymentMethodSchema } from '../visits/index.js';

export const paymentLedgerQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    method: paymentMethodSchema.optional(),
  })
  .refine((range) => range.from <= range.to, {
    path: ['to'],
    message: 'The end date cannot be before the start date',
  });

export type PaymentLedgerQuery = z.infer<typeof paymentLedgerQuerySchema>;
