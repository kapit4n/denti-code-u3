/**
 * PostgreSQL enums, defined once.
 *
 * These mirror the domain's status constants. They live here (and not in the
 * domain) because `pgEnum` is a Drizzle/PostgreSQL concept, and the domain must
 * stay free of any database concern. `database/schema/enums.test.ts` asserts the
 * two lists stay in sync, so a domain status added without a database enum
 * fails the build instead of failing a migration in production.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

import {
  APPOINTMENT_STATUSES,
  CLINIC_ROLES,
  DENTITIONS,
  INVOICE_STATUSES,
  MEDICATION_ROUTES,
  ODONTOGRAM_CONDITIONS,
  ODONTOGRAM_SURFACES,
  PAYMENT_METHODS,
  STOCK_MOVEMENT_TYPES,
  TREATMENT_PLAN_STATUSES,
  VISIT_STATUSES,
} from '@denti-code-u3/domain';

export const appointmentStatusEnum = pgEnum('appointment_status', APPOINTMENT_STATUSES);
export const visitStatusEnum = pgEnum('visit_status', VISIT_STATUSES);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const odontogramConditionEnum = pgEnum('odontogram_condition', ODONTOGRAM_CONDITIONS);
export const odontogramSurfaceEnum = pgEnum('odontogram_surface', ODONTOGRAM_SURFACES);
export const dentitionEnum = pgEnum('dentition', DENTITIONS);
export const treatmentPlanStatusEnum = pgEnum('treatment_plan_status', TREATMENT_PLAN_STATUSES);
export const medicationRouteEnum = pgEnum('medication_route', MEDICATION_ROUTES);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', STOCK_MOVEMENT_TYPES);
export const clinicRoleEnum = pgEnum('clinic_role', CLINIC_ROLES);

/**
 * The single source of truth used by `enums.test.ts` to prove the database and
 * the domain agree. Adding a status to the domain without adding it here is a
 * build failure, not a production surprise.
 */
export const DATABASE_ENUM_VALUES = {
  appointmentStatus: APPOINTMENT_STATUSES,
  visitStatus: VISIT_STATUSES,
  invoiceStatus: INVOICE_STATUSES,
  paymentMethod: PAYMENT_METHODS,
  odontogramCondition: ODONTOGRAM_CONDITIONS,
  odontogramSurface: ODONTOGRAM_SURFACES,
  dentition: DENTITIONS,
  treatmentPlanStatus: TREATMENT_PLAN_STATUSES,
  medicationRoute: MEDICATION_ROUTES,
  stockMovementType: STOCK_MOVEMENT_TYPES,
  clinicRole: CLINIC_ROLES,
} as const;
