import type {
  ClinicId,
  TreatmentPlanId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';
import type { TreatmentPlanRepository } from '../ports/index.js';

export interface CompleteTreatmentPlanItemDependencies {
  readonly treatmentPlans: TreatmentPlanRepository;
  readonly clock: Clock;
}

export async function completeTreatmentPlanItem(
  clinicId: ClinicId,

  planId: TreatmentPlanId,
  itemId: string,
  dependencies: CompleteTreatmentPlanItemDependencies,
): Promise<void> {
  const plan = await dependencies.treatmentPlans.getById?.(clinicId, planId);
  if (!plan) {
    throw notFound('TreatmentPlan', planId);
  }
  const now = dependencies.clock.now();
  const items = plan.items.map((item) =>
    item.id === itemId ? { ...item, isCompleted: true, completedAt: now } : item,
  );
  if (dependencies.treatmentPlans.save) {
    await dependencies.treatmentPlans.save({ ...plan, items, updatedAt: now });
  }
}
