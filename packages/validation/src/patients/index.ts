/**
 * Patient boundary schemas.
 *
 * These are the single definition used by the create/edit form, the API request
 * and the API response — so a field cannot exist on the client but be rejected by
 * the server, or vice versa.
 */

import { z } from 'zod';
import {
  emailSchema,
  isoDateSchema,
  moneyMinorUnitsSchema,
  paginatedResponseSchema,
  phoneSchema,
  uuidSchema,
} from '../common/index.js';

export const patientSchema = z.object({
  id: uuidSchema,
  clinicId: uuidSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().min(1).max(80).nullish(),
  identificationNumber: z.string().trim().min(1).max(32).nullish(),
  phone: phoneSchema.nullish(),
  email: emailSchema.nullish(),
  birthDate: isoDateSchema.nullish(),
  isActive: z.boolean(),
});

/** The full name is derived, never posted by the client. */
export const patientSummarySchema = patientSchema.extend({
  fullName: z.string(),
  ageInYears: z.int().min(0).max(130).nullish(),
});

/**
 * Messages are spelled out rather than left to Zod's defaults.
 *
 * These are not only for the API: the form validates with the same schema and
 * shows the message next to the field. Zod's default for `min(1)` is "Too small:
 * expected string to have >=1 characters", which tells a receptionist nothing
 * about what to type.
 */
export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80, 'First name is too long'),
  lastName: z.string().trim().min(1, 'Last name is required').max(80, 'Last name is too long'),
  preferredName: z
    .string()
    .trim()
    .min(1, 'Preferred name is too long')
    .max(80, 'Preferred name is too long')
    .optional(),
  identificationNumber: z
    .string()
    .trim()
    .min(1, 'Identification number is too long')
    .max(32, 'Identification number is too long')
    .optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  birthDate: isoDateSchema.optional(),
});

/**
 * `''`, or only whitespace: the state an untouched text input is in.
 *
 * Checked after trimming, so a field the user typed spaces into and left counts
 * as blank rather than as a value.
 */
const blankText = z
  .string()
  .trim()
  .refine((value) => value === '');

/**
 * A field that reads an empty input as "not supplied".
 *
 * `z.union` rather than `z.preprocess`, for a typing reason: preprocessing makes
 * the schema's *input* type `unknown`, and React Hook Form cannot derive its
 * field values from that. The member schema is the very same object
 * `createPatientSchema` uses, so the rules are shared rather than restated.
 *
 * Generic over the field's own type, so the resulting schema keeps its input
 * type: widening the parameter to a bare `z.ZodType` would make every optional
 * field `unknown` in the form and silently accept anything typed into it.
 */
function blankIsAbsent<TField extends z.ZodType>(field: TField) {
  return z
    .union([blankText, field])
    .transform((value) => (value === '' ? undefined : value))
    .optional();
}

/**
 * The form's view of `createPatientSchema`.
 *
 * The API rejects `''` for an optional field, because the same `min(1)` that
 * stops a blank name being stored applies to it. A form, though, submits `''` for
 * every field the user did not fill in — which is the normal case, not a mistake.
 * Without this schema a patient who gave no email and no phone could not be
 * registered at all.
 *
 * Every field is taken from `createPatientSchema.shape`, so the form accepts
 * exactly what the API accepts. `patients.test.ts` asserts the two schemas still
 * have the same keys, which is what stops this file drifting from its parent.
 */
export const createPatientFormSchema = z.object({
  firstName: createPatientSchema.shape.firstName,
  lastName: createPatientSchema.shape.lastName,
  preferredName: blankIsAbsent(createPatientSchema.shape.preferredName),
  identificationNumber: blankIsAbsent(createPatientSchema.shape.identificationNumber),
  phone: blankIsAbsent(createPatientSchema.shape.phone),
  email: blankIsAbsent(createPatientSchema.shape.email),
  birthDate: blankIsAbsent(createPatientSchema.shape.birthDate),
});

/**
 * The body of a patient edit.
 *
 * The same fields as `createPatientSchema` — an edit covers the same ground — but
 * read with different meaning: an absent optional field means "this patient does
 * not have one", not "leave the stored value". That is why the endpoint is a PUT
 * and why it can clear an email without inventing a null-for-unset convention.
 *
 * `isActive` is deliberately absent. Deactivating a patient changes what the
 * product may do with the record; it is a deliberate action with its own
 * confirmation, not a checkbox on a form someone opened to fix a misspelling.
 */
export const updatePatientSchema = createPatientSchema;

/**
 * The form's view of an edit.
 *
 * Blank optional inputs resolve to absent, exactly as on the create form, so an
 * edit can clear a field with the same gesture that registers a patient without
 * one.
 */
export const updatePatientFormSchema = createPatientFormSchema;

export const searchPatientsQuerySchema = z.object({
  /** Matches name, phone or identification. */
  q: z.string().trim().min(1).max(120).optional(),
  onlyActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const patientBalanceSchema = z.object({
  currency: z.string().length(3),
  outstandingMinor: moneyMinorUnitsSchema,
  unallocatedPaymentsMinor: moneyMinorUnitsSchema,
  balanceMinor: moneyMinorUnitsSchema,
});

export const patientProfileSchema = patientSummarySchema.extend({
  balance: patientBalanceSchema.nullish(),
});

export const paginatedPatientSchema = paginatedResponseSchema(patientSummarySchema);

export type PatientDto = z.infer<typeof patientSchema>;
export type PatientSummaryDto = z.infer<typeof patientSummarySchema>;
export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type CreatePatientFormValues = z.input<typeof createPatientFormSchema>;
/** What the form hands to the mutation: blanks already resolved to absent. */
export type CreatePatientFormOutput = z.output<typeof createPatientFormSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type UpdatePatientFormValues = z.input<typeof updatePatientFormSchema>;
export type UpdatePatientFormOutput = z.output<typeof updatePatientFormSchema>;
export type SearchPatientsQuery = z.infer<typeof searchPatientsQuerySchema>;
export type PatientBalanceDto = z.infer<typeof patientBalanceSchema>;
export type PatientProfileDto = z.infer<typeof patientProfileSchema>;
