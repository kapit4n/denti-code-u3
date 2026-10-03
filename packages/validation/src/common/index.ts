/**
 * Shared Zod building blocks for Denti-Code U3.
 *
 * These are the primitives every boundary schema is assembled from. Defining them
 * once is what keeps a client-side form rule and the server-side API rule from
 * drifting apart.
 */

import { z } from 'zod';

/** PostgreSQL UUID primary keys. */
export const uuidSchema = z.uuid();

/** ISO-8601 instant with an explicit UTC offset, e.g. `2026-09-30T14:00:00.000Z`. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** ISO calendar date, e.g. `2026-09-30`. */
export const isoDateSchema = z.iso.date();

/** IANA timezone identifier, e.g. `America/Argentina/Buenos_Aires`. */
export const timeZoneSchema = z.string().refine(
  (candidate) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a valid IANA time zone' },
);

/** ISO-4217 currency code. */
export const currencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, { message: 'Must be an uppercase ISO-4217 code' });

/** Money as an integer in the currency's minor unit. Never a float. */
export const moneyMinorUnitsSchema = z.int();

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[\d\s()+-]+$/, { message: 'A phone number may only contain digits and separators' });

export const emailSchema = z.email();

/**
 * The single error envelope every failing API response uses.
 * `requestId` is what makes a user-reported error traceable in the logs.
 */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
