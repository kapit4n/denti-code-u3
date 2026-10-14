/**
 * Moving a treatment plan along: its status, its title, its notes.
 *
 * A plan's editable surface is small on purpose — what has been *planned* (its
 * items) is written when the plan is created, and editing a plan's lines is not a
 * use case yet. This is the door that presents a plan, accepts or declines it, and
 * lets a title or a note be corrected.
 *
 * **No transition graph is invented.** The status is set to whatever the caller
 * stated, provided it is a status the domain knows; the product has not yet decided
 * which moves are legal (a draft may or may not be reopenable), so a rule here would
 * be a rule the domain cannot cite. What the plan *does* record is when it was
 * presented and accepted — `presentedAt` is stamped the first time the plan becomes
 * `PROPOSED`, `acceptedAt` the first time it becomes `ACCEPTED`, and neither is ever
 * overwritten, so the dates tell when it first happened even if the status later
 * moves on.
 *
 * The patient is read first (ADR 0014), so a plan is never updated through a
 * patient this clinic does not hold, and the plan itself is read scoped to both the
 * clinic and that patient, so one patient's plan can never be reached through
 * another's path.
 */
import type { ClinicId, PatientId, TreatmentPlanId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { PatientRepository, TreatmentPlanRepository } from '../ports/index.js';
import { TREATMENT_PLAN_STATUSES, type TreatmentPlanStatus } from './treatment-plan.js';

export interface UpdateTreatmentPlanInput {
  readonly status?: TreatmentPlanStatus;
  readonly title?: string | null;
  readonly notes?: string | null;
}

export interface UpdateTreatmentPlanDependencies {
  readonly patients: Pick<PatientRepository, 'findProfile'>;
  readonly treatmentPlans: Pick<TreatmentPlanRepository, 'getForPatient' | 'save'>;
  readonly clock: Clock;
}

export async function updateTreatmentPlan(
  clinicId: ClinicId,
  patientId: PatientId,
  planId: TreatmentPlanId,
  input: UpdateTreatmentPlanInput,
  dependencies: UpdateTreatmentPlanDependencies,
): Promise<void> {
  const patient = await dependencies.patients.findProfile(clinicId, patientId);
  if (!patient) {
    throw notFound('Patient', patientId);
  }

  const plan = await dependencies.treatmentPlans.getForPatient(clinicId, patientId, planId);
  if (!plan) {
    throw notFound('TreatmentPlan', planId);
  }

  const now = dependencies.clock.now();

  let status = plan.status;
  if (input.status !== undefined) {
    if (!(TREATMENT_PLAN_STATUSES as readonly string[]).includes(input.status)) {
      throw new DomainError('INVALID_INPUT', `"${input.status}" is not a treatment plan status`, {
        status: input.status,
      });
    }
    status = input.status;
  }

  // A blank title or note is a `null`, never an empty string — the same "a blank is
  // the absence of the thing" the rest of the write path keeps. An omitted field
  // (`undefined`) leaves the stored value alone; an explicit `null` clears it.
  const title = input.title === undefined ? plan.title : input.title?.trim() || null;
  const notes = input.notes === undefined ? plan.notes : input.notes?.trim() || null;

  const presentedAt = status === 'PROPOSED' && plan.presentedAt === null ? now : plan.presentedAt;
  const acceptedAt = status === 'ACCEPTED' && plan.acceptedAt === null ? now : plan.acceptedAt;

  await dependencies.treatmentPlans.save({
    ...plan,
    status,
    title,
    notes,
    presentedAt,
    acceptedAt,
    updatedAt: now,
  });
}
