/**
 * Proposing a treatment plan for a patient — the write side of Milestone 8's
 * plans.
 *
 * A plan is its lines, so the use case that writes one writes the whole plan: the
 * plan row with its status `DRAFT`, and one row per item. Everything a client does
 * not state is the server's — the plan id, each item's id, the status, the clock,
 * and the `presentedAt`/`acceptedAt` stamps that stay empty until a later update
 * moves the plan through its statuses. **Nothing is written on trust: the patient,
 * the dentist and every named treatment are read in this clinic before the plan is
 * built**, so a body naming something the clinic does not hold is refused with the
 * field's own sentence rather than stored behind a foreign key (ADR 0014).
 *
 * The tooth and the surfaces are the only clinical facts an item carries, and both
 * are judged here as they are on the odontogram: the tooth is FDI (its number is
 * what says which dentition it belongs to), the surfaces are the odontogram's own
 * enum in canonical order and freed of duplicates. The plan item records *planned*
 * work rather than a finding, so unlike a chart entry it needs no condition and a
 * surface is not weighed against the tooth it sits on — a plan can propose work on
 * a surface without having decided the whole tooth.
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
import type {
  DentistRepository,
  PatientRepository,
  TreatmentPlanItemSummary,
  TreatmentPlanItemWriteModel,
  TreatmentPlanRepository,
  TreatmentPlanSummary,
  TreatmentPlanWriteModel,
  TreatmentRepository,
} from '../ports/index.js';
import { ODONTOGRAM_SURFACES } from '../odontogram/index.js';
import { describeTreatmentPlanProgress } from './treatment-plan.js';

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
  readonly patients: Pick<PatientRepository, 'findProfile'>;
  readonly dentists: Pick<DentistRepository, 'findById'>;
  readonly treatments: Pick<TreatmentRepository, 'findById'>;
  readonly treatmentPlans: Pick<TreatmentPlanRepository, 'save'>;
  readonly clock: Clock;
  readonly newId: () => TreatmentPlanId;
  readonly newItemId: () => string;
}

/**
 * Build the plan and save it whole.
 *
 * Returns the summary shape the plan reads as — items carrying the treatment's
 * code and name, and the progress projection — so the endpoint can answer 201 with
 * exactly what the plans list will show once it refetches, rather than a body
 * assembled from the request that was never stored.
 */
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
  const writeItems: TreatmentPlanItemWriteModel[] = [];
  const summaryItems: TreatmentPlanItemSummary[] = [];

  for (const item of input.items) {
    let treatmentCode: string | null = null;
    let treatmentName: string | null = null;

    if (item.treatmentId) {
      const treatment = await dependencies.treatments.findById(clinicId, item.treatmentId);
      if (!treatment) {
        throw new DomainError('INVALID_INPUT', 'The treatment does not exist in this clinic', {
          treatmentId: item.treatmentId,
        });
      }
      treatmentCode = treatment.code;
      treatmentName = treatment.name;
    }

    const tooth = normalizeTooth(item.tooth);
    const surfaces = normalizeSurfaces(item.surfaces ?? []);
    const notes = item.notes?.trim() || null;
    const itemId = dependencies.newItemId();

    const shared = {
      treatmentId: item.treatmentId ?? null,
      tooth,
      surfaces,
      quantity: item.quantity ?? 1,
      estimatedPriceMinor: item.estimatedPriceMinor ?? 0,
      isCompleted: false,
      completedAt: null,
      notes,
    };

    writeItems.push({ id: itemId, ...shared });
    summaryItems.push({ id: itemId, treatmentCode, treatmentName, ...shared });
  }

  const title = input.title?.trim() || null;
  const notes = input.notes?.trim() || null;

  const plan: TreatmentPlanWriteModel = {
    id: planId,
    clinicId,
    patientId: input.patientId,
    dentistId: input.dentistId ?? null,
    status: 'DRAFT',
    title,
    notes,
    presentedAt: null,
    acceptedAt: null,
    updatedAt: now,
    items: writeItems,
  };

  await dependencies.treatmentPlans.save(plan);

  return {
    id: planId,
    dentistId: plan.dentistId,
    status: plan.status,
    title,
    notes,
    presentedAt: null,
    acceptedAt: null,
    updatedAt: now,
    items: summaryItems,
    progress: describeTreatmentPlanProgress(summaryItems),
  };
}

/** A blank tooth is `null`; anything else must be a real FDI number. */
function normalizeTooth(tooth: string | null | undefined): string | null {
  const trimmed = tooth?.trim();
  if (!trimmed) {
    return null;
  }
  // `dentitionForTooth` throws `INVALID_INPUT` with the number in its sentence for
  // anything that is not FDI, so the plan stores a tooth the odontogram would draw.
  assertFdiTooth(trimmed);
  return trimmed;
}

function assertFdiTooth(tooth: string): void {
  if (!/^([1-4][1-8]|[5-8][1-5])$/.test(tooth)) {
    throw new DomainError('INVALID_INPUT', `"${tooth}" is not a valid FDI tooth number`, { tooth });
  }
}

/**
 * The odontogram's surfaces in their canonical order, deduplicated.
 *
 * A surface the domain does not know is refused with its own sentence rather than
 * silently dropped: the write path is where a bad value has to be named.
 */
function normalizeSurfaces(surfaces: readonly string[]): readonly string[] {
  for (const surface of surfaces) {
    if (!(ODONTOGRAM_SURFACES as readonly string[]).includes(surface)) {
      throw new DomainError('INVALID_INPUT', `"${surface}" is not a surface of a tooth`, {
        surface,
      });
    }
  }

  return ODONTOGRAM_SURFACES.filter((surface) => surfaces.includes(surface));
}
