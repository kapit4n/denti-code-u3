/**
 * Treatment-plan persistence, on PostgreSQL.
 *
 * The read is the patient's plans *with* their items, because a plan is its lines
 * and a reader that gets one without the other has to ask twice per plan. The plans
 * table carries its own `clinic_id`, so tenancy is scoped in the statement — the
 * charge pattern, not the join the notes need — and the patient is resolved first so
 * a foreign patient answers `undefined` (the same 404 the profile and the odontogram
 * give) rather than an empty list (ADR 0014).
 *
 * Ordering: plans newest first (`created_at` desc, id as the tiebreak — the order a
 * patient's plans read in), items by id (asc — `treatment_plan_items` has no sequence
 * column, so id order is the deterministic one the seeds laid the plan out in).
 *
 * Progress is the domain's own projection over the rows' `is_completed` flags, so
 * this engine and its SQLite twin cannot disagree about what a plan's progress is.
 */
import {
  describeTreatmentPlanProgress,
  type TreatmentPlanItemSummary,
  type TreatmentPlanRepository,
  type TreatmentPlanSummary,
} from '@denti-code-u3/domain';
import {
  asDentistId,
  asTreatmentId,
  asTreatmentPlanId,
  type ClinicId,
  type PatientId,
} from '@denti-code-u3/types';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import {
  patients,
  treatmentPlanItems,
  treatmentPlans,
  treatments,
} from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';

export class DrizzleTreatmentPlanRepository implements TreatmentPlanRepository {
  constructor(private readonly db: DentiDatabase) {}

  async listForPatient(
    clinicId: ClinicId,
    patientId: PatientId,
  ): Promise<readonly TreatmentPlanSummary[] | undefined> {
    const [patient] = await this.db
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, clinicId),
          eq(patients.id, patientId),
          isNull(patients.anonymizedAt),
        ),
      )
      .limit(1);

    if (!patient) {
      return undefined;
    }

    const planRows = await this.db
      .select()
      .from(treatmentPlans)
      .where(and(eq(treatmentPlans.clinicId, clinicId), eq(treatmentPlans.patientId, patientId)))
      .orderBy(desc(treatmentPlans.createdAt), desc(treatmentPlans.id));

    const planIds = planRows.map((plan) => plan.id);

    // The items' clinic filter is defence in depth: the plan ids are already scoped
    // above, and this join repeats the filter so an item can never be read through
    // a plan that changed clinics under it (ADR 0014).
    const itemRows =
      planIds.length === 0
        ? []
        : await this.db
            .select({
              id: treatmentPlanItems.id,
              treatmentPlanId: treatmentPlanItems.treatmentPlanId,
              treatmentId: treatmentPlanItems.treatmentId,
              treatmentCode: treatments.code,
              treatmentName: treatments.name,
              tooth: treatmentPlanItems.tooth,
              surfaces: treatmentPlanItems.surfaces,
              quantity: treatmentPlanItems.quantity,
              estimatedPriceMinor: treatmentPlanItems.estimatedPriceMinor,
              isCompleted: treatmentPlanItems.isCompleted,
              completedAt: treatmentPlanItems.completedAt,
              notes: treatmentPlanItems.notes,
            })
            .from(treatmentPlanItems)
            .innerJoin(treatmentPlans, eq(treatmentPlanItems.treatmentPlanId, treatmentPlans.id))
            .leftJoin(treatments, eq(treatmentPlanItems.treatmentId, treatments.id))
            .where(
              and(
                inArray(treatmentPlanItems.treatmentPlanId, planIds),
                eq(treatmentPlans.clinicId, clinicId),
              ),
            )
            .orderBy(asc(treatmentPlanItems.id));

    const itemsByPlan = new Map<string, TreatmentPlanItemSummary[]>();
    for (const row of itemRows) {
      const items = itemsByPlan.get(row.treatmentPlanId) ?? [];
      items.push(toItemSummary(row));
      itemsByPlan.set(row.treatmentPlanId, items);
    }

    return planRows.map((plan) => {
      const items = itemsByPlan.get(plan.id) ?? [];
      return {
        id: asTreatmentPlanId(plan.id),
        dentistId: plan.dentistId === null ? null : asDentistId(plan.dentistId),
        status: plan.status,
        title: plan.title,
        notes: plan.notes,
        presentedAt: plan.presentedAt === null ? null : plan.presentedAt.toISOString(),
        acceptedAt: plan.acceptedAt === null ? null : plan.acceptedAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        items,
        progress: describeTreatmentPlanProgress(items),
      };
    });
  }
}

function toItemSummary(row: {
  id: string;
  treatmentId: string | null;
  treatmentCode: string | null;
  treatmentName: string | null;
  tooth: string | null;
  surfaces: string[];
  quantity: number;
  estimatedPriceMinor: number;
  isCompleted: boolean;
  completedAt: Date | null;
  notes: string | null;
}): TreatmentPlanItemSummary {
  return {
    id: row.id,
    treatmentId: row.treatmentId === null ? null : asTreatmentId(row.treatmentId),
    treatmentCode: row.treatmentCode,
    treatmentName: row.treatmentName,
    tooth: row.tooth,
    surfaces: row.surfaces,
    quantity: row.quantity,
    estimatedPriceMinor: row.estimatedPriceMinor,
    isCompleted: row.isCompleted,
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    notes: row.notes,
  };
}
