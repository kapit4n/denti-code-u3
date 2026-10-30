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

const localTimeSchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Opening hours are written as HH:MM');

export const clinicOperatingHoursSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    opensAtLocalTime: z.string(),
    closesAtLocalTime: z.string(),
    isClosed: z.boolean(),
  })
  .superRefine((hours, context) => {
    if (hours.isClosed) {
      return;
    }
    const opens = localTimeSchema.safeParse(hours.opensAtLocalTime);
    if (!opens.success) {
      context.addIssue({
        code: 'custom',
        path: ['opensAtLocalTime'],
        message: 'Opening time is written as HH:MM',
      });
    }
    const closes = localTimeSchema.safeParse(hours.closesAtLocalTime);
    if (!closes.success) {
      context.addIssue({
        code: 'custom',
        path: ['closesAtLocalTime'],
        message: 'Closing time is written as HH:MM',
      });
    }
    if (opens.success && closes.success && opens.data >= closes.data) {
      context.addIssue({
        code: 'custom',
        path: ['closesAtLocalTime'],
        message: 'Closing time must be after opening time',
      });
    }
  });

export const updateClinicSettingsSchema = z.object({
  name: z.string().trim().min(1, 'The clinic needs a name').max(200, 'The clinic name is too long'),
  legalName: z.string().trim().max(200, 'The legal name is too long').optional().nullable(),
  taxId: z.string().trim().max(50, 'The tax id is too long').optional().nullable(),
  address: z.string().trim().max(500, 'The address is too long').optional().nullable(),
  phone: z.string().trim().max(50, 'The phone is too long').optional().nullable(),
  email: z.string().trim().max(200, 'The email is too long').optional().nullable(),
  timeZone: z
    .string()
    .trim()
    .min(1, 'A time zone is required')
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'That is not a valid IANA time zone'),
  currency: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), 'A currency is a three-letter ISO code'),
  operatingHours: z
    .array(clinicOperatingHoursSchema)
    .max(7, 'A week has seven days')
    .superRefine((hours, context) => {
      const seen = new Set<number>();
      for (const [index, entry] of hours.entries()) {
        if (seen.has(entry.weekday)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'weekday'],
            message: 'A weekday may only be listed once',
          });
        }
        seen.add(entry.weekday);
      }
    }),
});

export type UpdateClinicSettingsInput = z.infer<typeof updateClinicSettingsSchema>;
