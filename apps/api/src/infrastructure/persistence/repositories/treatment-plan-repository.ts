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
  DomainError,
  describeTreatmentPlanProgress,
  type TreatmentPlanItemSummary,
  type TreatmentPlanItemWriteModel,
  type TreatmentPlanRepository,
  type TreatmentPlanSummary,
  type TreatmentPlanWriteModel,
} from '@denti-code-u3/domain';
import {
  asDentistId,
  asTreatmentId,
  asTreatmentPlanId,
  type ClinicId,
  type PatientId,
  type TreatmentPlanId,
} from '@denti-code-u3/types';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import {
  patients,
  treatmentPlanItems,
  treatmentPlans,
  treatments,
} from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

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

  async getForPatient(
    clinicId: ClinicId,
    patientId: PatientId,
    id: TreatmentPlanId,
  ): Promise<TreatmentPlanWriteModel | undefined> {
    const [plan] = await this.db
      .select()
      .from(treatmentPlans)
      .where(
        and(
          eq(treatmentPlans.clinicId, clinicId),
          eq(treatmentPlans.patientId, patientId),
          eq(treatmentPlans.id, id),
        ),
      )
      .limit(1);

    if (!plan) {
      return undefined;
    }

    const itemRows = await this.db
      .select({
        id: treatmentPlanItems.id,
        treatmentId: treatmentPlanItems.treatmentId,
        tooth: treatmentPlanItems.tooth,
        surfaces: treatmentPlanItems.surfaces,
        quantity: treatmentPlanItems.quantity,
        estimatedPriceMinor: treatmentPlanItems.estimatedPriceMinor,
        isCompleted: treatmentPlanItems.isCompleted,
        completedAt: treatmentPlanItems.completedAt,
        notes: treatmentPlanItems.notes,
      })
      .from(treatmentPlanItems)
      .where(eq(treatmentPlanItems.treatmentPlanId, plan.id))
      .orderBy(asc(treatmentPlanItems.id));

    return {
      id: asTreatmentPlanId(plan.id),
      clinicId,
      patientId,
      dentistId: plan.dentistId === null ? null : asDentistId(plan.dentistId),
      status: plan.status,
      title: plan.title,
      notes: plan.notes,
      presentedAt: plan.presentedAt === null ? null : plan.presentedAt.toISOString(),
      acceptedAt: plan.acceptedAt === null ? null : plan.acceptedAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      items: itemRows.map(toWriteItem),
    };
  }

  /**
   * Upsert the plan and each of its lines, in one transaction.
   *
   * The plan row is upserted on its id; `clinic_id` and `patient_id` are written on
   * insert but deliberately **not** in the `ON CONFLICT` set, so a save can never
   * move an existing plan between tenants. `created_at` is left to the column's
   * default and never touched by an update. Each item is upserted on its own id and
   * its `treatment_plan_id` is likewise left out of the set — an item is never moved
   * to another plan, and nothing here deletes an item, because
   * `visit_treatment_executions` references it (`ON DELETE SET NULL` would unlink a
   * performed treatment from the line that named it).
   *
   * A foreign-key refusal — a patient, dentist or treatment that vanished between
   * the use case's read and this write — is translated to a `NOT_FOUND` naming the
   * patient, the subject the use case read first, the same answer the charge and
   * odontogram repositories give.
   */
  async save(plan: TreatmentPlanWriteModel): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .insert(treatmentPlans)
          .values({
            id: plan.id,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            dentistId: plan.dentistId,
            status: plan.status,
            title: plan.title,
            notes: plan.notes,
            presentedAt: plan.presentedAt === null ? null : new Date(plan.presentedAt),
            acceptedAt: plan.acceptedAt === null ? null : new Date(plan.acceptedAt),
            updatedAt: new Date(plan.updatedAt),
          })
          .onConflictDoUpdate({
            target: treatmentPlans.id,
            set: {
              dentistId: plan.dentistId,
              status: plan.status,
              title: plan.title,
              notes: plan.notes,
              presentedAt: plan.presentedAt === null ? null : new Date(plan.presentedAt),
              acceptedAt: plan.acceptedAt === null ? null : new Date(plan.acceptedAt),
              updatedAt: new Date(plan.updatedAt),
            },
          });

        for (const item of plan.items) {
          await tx
            .insert(treatmentPlanItems)
            .values({
              id: item.id,
              treatmentPlanId: plan.id,
              treatmentId: item.treatmentId,
              tooth: item.tooth,
              surfaces: [...item.surfaces],
              quantity: item.quantity,
              estimatedPriceMinor: item.estimatedPriceMinor,
              isCompleted: item.isCompleted,
              completedAt: item.completedAt === null ? null : new Date(item.completedAt),
              notes: item.notes,
            })
            .onConflictDoUpdate({
              target: treatmentPlanItems.id,
              set: {
                treatmentId: item.treatmentId,
                tooth: item.tooth,
                surfaces: [...item.surfaces],
                quantity: item.quantity,
                estimatedPriceMinor: item.estimatedPriceMinor,
                isCompleted: item.isCompleted,
                completedAt: item.completedAt === null ? null : new Date(item.completedAt),
                notes: item.notes,
              },
            });
        }
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${plan.patientId} was not found`, {
          entity: 'Patient',
          id: plan.patientId,
        });
      }
      throw error;
    }
  }
}

function toWriteItem(row: {
  id: string;
  treatmentId: string | null;
  tooth: string | null;
  surfaces: string[];
  quantity: number;
  estimatedPriceMinor: number;
  isCompleted: boolean;
  completedAt: Date | null;
  notes: string | null;
}): TreatmentPlanItemWriteModel {
  return {
    id: row.id,
    treatmentId: row.treatmentId === null ? null : asTreatmentId(row.treatmentId),
    tooth: row.tooth,
    surfaces: row.surfaces,
    quantity: row.quantity,
    estimatedPriceMinor: row.estimatedPriceMinor,
    isCompleted: row.isCompleted,
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    notes: row.notes,
  };
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
