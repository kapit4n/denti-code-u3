import type { DentistId, PatientId, TreatmentId } from '@denti-code-u3/types';
import type { MoneyAmount } from '../billing/money.js';
import { sumMoney } from '../billing/money.js';

export const TREATMENT_PLAN_STATUSES = [
  'DRAFT',
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TreatmentPlanStatus = (typeof TREATMENT_PLAN_STATUSES)[number];

export const TREATMENT_PLAN_ITEM_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TreatmentPlanItemStatus = (typeof TREATMENT_PLAN_ITEM_STATUSES)[number];

export interface TreatmentPlanItem {
  readonly id: string;
  readonly treatmentId: TreatmentId;
  readonly toothRef?: string;
  readonly sequence: number;
  readonly status: TreatmentPlanItemStatus;
  readonly estimatedPrice: MoneyAmount;
}

export interface TreatmentPlan {
  readonly id: string;
  readonly clinicId: string;
  readonly patientId: PatientId;
  readonly dentistId: DentistId;
  readonly title: string;
  readonly status: TreatmentPlanStatus;
  readonly startedAt?: string;
  readonly items: readonly TreatmentPlanItem[];
}

export interface TreatmentPlanProgress {
  readonly total: number;
  readonly completed: number;
  readonly inProgress: number;
  readonly pending: number;
  readonly percentComplete: number;
}

/** Treatment plan progress is a projection, never a stored counter. */
export function calculateTreatmentPlanProgress(plan: TreatmentPlan): TreatmentPlanProgress {
  const items = plan.items;
  const total = items.length;
  const completed = items.filter((item) => item.status === 'COMPLETED').length;
  const inProgress = items.filter((item) => item.status === 'IN_PROGRESS').length;
  const pending = total - completed - inProgress;
  const percentComplete = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { total, completed, inProgress, pending, percentComplete };
}

/**
 * Progress of a treatment plan as the stored table tells it.
 *
 * This is the read side's projection, deliberately over the shape the row holds
 * (`isCompleted`) rather than the rich `TreatmentPlanItem` above. The table has no
 * per-item status column — a line of a plan is done or it is not — and a projection
 * that invented `PENDING`/`IN_PROGRESS` states would be the domain firming up a
 * column that does not exist, the same realignment `TreatmentCatalogueItem` went
 * through in session 30. `inProgress` is therefore always `0`, and `pending` means
 * "not completed", which is all the row can say. The repositories call it, so a
 * plan drawn on PostgreSQL and one drawn on SQLite cannot disagree.
 */
export function describeTreatmentPlanProgress(
  items: readonly { readonly isCompleted: boolean }[],
): TreatmentPlanProgress {
  const total = items.length;
  const completed = items.filter((item) => item.isCompleted).length;
  const inProgress = 0;
  const pending = total - completed;
  const percentComplete = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { total, completed, inProgress, pending, percentComplete };
}

/** Estimate the total price of a treatment plan from its items. */
export function calculateTreatmentPlanEstimate(
  plan: TreatmentPlan,
  fallbackCurrency: string,
): MoneyAmount {
  const [firstItem] = plan.items;
  const currency = firstItem?.estimatedPrice.currency ?? fallbackCurrency;
  return sumMoney(
    plan.items.map((item) => item.estimatedPrice),
    currency,
  );
}
