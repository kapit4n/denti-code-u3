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

export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  preferredName: z.string().trim().min(1).max(80).optional(),
  identificationNumber: z.string().trim().min(1).max(32).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  birthDate: isoDateSchema.optional(),
});

export const updatePatientSchema = createPatientSchema.partial().extend({
  isActive: z.boolean().optional(),
});

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
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type SearchPatientsQuery = z.infer<typeof searchPatientsQuerySchema>;
export type PatientBalanceDto = z.infer<typeof patientBalanceSchema>;
export type PatientProfileDto = z.infer<typeof patientProfileSchema>;
