import type {
  ClinicId,
  PatientId,
  TreatmentPlanId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';
import type { DentistRepository, PatientRepository, TreatmentPlanRepository, TreatmentRepository } from '../ports/index.js';


export interface UpdateTreatmentPlanInput {
  readonly status?: 'DRAFT' | 'PRESENTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | null;
  readonly title?: string | null;
  readonly notes?: string | null;
}

export interface UpdateTreatmentPlanDependencies {
  readonly patients: PatientRepository;
  readonly dentists: DentistRepository;
  readonly treatments: TreatmentRepository;
  readonly treatmentPlans: TreatmentPlanRepository;
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
  const plan = await dependencies.treatmentPlans.getById?.(clinicId, planId);
  if (!plan) {
    throw notFound('TreatmentPlan', planId);
  }
  if (dependencies.treatmentPlans.save) {
    await dependencies.treatmentPlans.save({
      ...plan,
      status: input.status ?? plan.status,
      title: input.title ?? plan.title,
      notes: input.notes ?? plan.notes,
      updatedAt: dependencies.clock.now(),
    } as any);
  }
}
