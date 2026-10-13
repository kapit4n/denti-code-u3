/**
 * Creating and updating treatment plans.
 */

import type {
  ClinicId,
  DentistId,
  PatientId,
  TreatmentId,
  TreatmentPlanId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { DentistRepository, PatientRepository, TreatmentPlanRepository, TreatmentRepository } from '../ports/index.js';
import type { TreatmentPlanItemSummary, TreatmentPlanSummary } from '../ports/index.js';

export interface CreateTreatmentPlanInput {
  readonly patientId: PatientId;
  readonly dentistId?: DentistId | null;
  readonly title?: string | null;
  readonly notes?: string | null;
  readonly items: readonly {
    readonly treatmentId?: TreatmentId | null;
    readonly tooth?: string | null;
    readonly surfaces?: readonly string[];
    readonly quantity?: number;
    readonly estimatedPriceMinor?: number;
    readonly notes?: string | null;
  }[];
}

export interface CreateTreatmentPlanDependencies {
  readonly patients: PatientRepository;
  readonly dentists: DentistRepository;
  readonly treatments: TreatmentRepository;
  readonly treatmentPlans: TreatmentPlanRepository;
  readonly clock: Clock;
  readonly newId: () => TreatmentPlanId;
  readonly newItemId: () => string;
}

export async function createTreatmentPlan(
  clinicId: ClinicId,
  input: CreateTreatmentPlanInput,
  dependencies: CreateTreatmentPlanDependencies,
): Promise<TreatmentPlanSummary> {
  const patient = await dependencies.patients.findProfile(clinicId, input.patientId);
  if (!patient) {
    throw notFound('Patient', input.patientId);
  }

  if (input.dentistId) {
    const dentist = await dependencies.dentists.findById(clinicId, input.dentistId);
    if (!dentist) {
      throw new DomainError('INVALID_INPUT', 'The dentist does not belong to this clinic', {
        dentistId: input.dentistId,
      });
    }
  }

  const now = dependencies.clock.now();
  const planId = dependencies.newId();
  const items: TreatmentPlanItemSummary[] = [];

  for (const item of input.items) {
    if (item.treatmentId) {
      const treatment = await dependencies.treatments.findById(clinicId, item.treatmentId);
      if (!treatment) {
        throw new DomainError('INVALID_INPUT', 'The treatment does not exist in this clinic', {
          treatmentId: item.treatmentId,
        });
      }
    }
    items.push({
      id: dependencies.newItemId(),
      treatmentId: item.treatmentId ?? null,
      treatmentCode: null,
      treatmentName: null,
      tooth: item.tooth ?? null,
      surfaces: [...(item.surfaces ?? [])],
      quantity: item.quantity ?? 1,
      estimatedPriceMinor: item.estimatedPriceMinor ?? 0,
      isCompleted: false,
      completedAt: null,
      notes: item.notes ?? null,
    });
  }

  const plan: TreatmentPlanSummary = {
    id: planId,
    dentistId: input.dentistId ?? null,
    status: 'DRAFT',
    title: input.title ?? null,
    notes: input.notes ?? null,
    presentedAt: null,
    acceptedAt: null,
    updatedAt: now,
    items,
    progress: {
      total: items.length,
      completed: 0,
      inProgress: 0,
      pending: items.length,
      percentComplete: 0,
    },
  };

  if (dependencies.treatmentPlans.add) {
    await dependencies.treatmentPlans.add(plan);
  } else if (dependencies.treatmentPlans.save) {
    await dependencies.treatmentPlans.save(plan);
  }

  return plan;
}
