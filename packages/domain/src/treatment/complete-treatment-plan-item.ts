/**
 * Marking one line of a treatment plan done.
 *
 * A plan item is done or it is not — the table has no per-item status, and this is
 * the only write that flips the flag. Completing is **idempotent by keeping the
 * first stamp**: an item already done is left alone, so `completedAt` records when
 * the treatment was actually finished and a second tap cannot move it. The item has
 * to belong to the plan on the path — a mismatched id is a 404, never a silent
 * no-op, because a save that succeeded while nothing changed is the worst answer a
 * write can give.
 *
 * The patient is read first and the plan is read scoped to both the clinic and that
 * patient (ADR 0014), so neither a foreign patient nor another patient's plan can
 * be reached through this path.
 */
import type { ClinicId, PatientId, TreatmentPlanId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';
import type { PatientRepository, TreatmentPlanRepository } from '../ports/index.js';

export interface CompleteTreatmentPlanItemDependencies {
  readonly patients: Pick<PatientRepository, 'findProfile'>;
  readonly treatmentPlans: Pick<TreatmentPlanRepository, 'getForPatient' | 'save'>;
  readonly clock: Clock;
}

export async function completeTreatmentPlanItem(
  clinicId: ClinicId,
  patientId: PatientId,
  planId: TreatmentPlanId,
  itemId: string,
  dependencies: CompleteTreatmentPlanItemDependencies,
): Promise<void> {
  const patient = await dependencies.patients.findProfile(clinicId, patientId);
  if (!patient) {
    throw notFound('Patient', patientId);
  }

  const plan = await dependencies.treatmentPlans.getForPatient(clinicId, patientId, planId);
  if (!plan) {
    throw notFound('TreatmentPlan', planId);
  }

  const item = plan.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw notFound('TreatmentPlanItem', itemId);
  }

  // Already done: leave the first stamp where it is. The write is the completion,
  // not the tap, so a second tap is not a second write.
  if (item.isCompleted) {
    return;
  }

  const now = dependencies.clock.now();

  await dependencies.treatmentPlans.save({
    ...plan,
    items: plan.items.map((candidate) =>
      candidate.id === itemId ? { ...candidate, isCompleted: true, completedAt: now } : candidate,
    ),
    updatedAt: now,
  });
}
