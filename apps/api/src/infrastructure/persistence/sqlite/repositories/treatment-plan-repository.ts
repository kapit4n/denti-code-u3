/**
 * Treatment-plan persistence, on SQLite — the twin of
 * `repositories/treatment-plan-repository.ts` (ADR 0025).
 *
 * The kit is the same file in every way that matters: the patient resolved first
 * so a foreign patient is `undefined` and not `[]`, the tenant scope in the plans
 * statement (the table has its own `clinic_id`), the items joined for their
 * treatment labels, and the domain's own progress projection. The differences are
 * the engine's — the schema entry point and the synchronous `.all()` this driver
 * needs for a read to happen at all.
 *
 * Ordering is the twin's too: plans newest first, items by id — the deterministic
 * order the seeds laid the plan out in, since `treatment_plan_items` has no
 * sequence column.
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
} from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

export class SQLiteTreatmentPlanRepository implements TreatmentPlanRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async listForPatient(
    clinicId: ClinicId,
    patientId: PatientId,
  ): Promise<readonly TreatmentPlanSummary[] | undefined> {
    const patient = this.db
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, clinicId),
          eq(patients.id, patientId),
          isNull(patients.anonymizedAt),
        ),
      )
      .get();

    if (!patient) {
      return undefined;
    }

    const planRows = this.db
      .select()
      .from(treatmentPlans)
      .where(and(eq(treatmentPlans.clinicId, clinicId), eq(treatmentPlans.patientId, patientId)))
      .orderBy(desc(treatmentPlans.createdAt), desc(treatmentPlans.id))
      .all();

    const planIds = planRows.map((plan) => plan.id);

    // The clinic filter on the items is the same defence in depth the PostgreSQL
    // twin keeps: the plan ids are already scoped, and the join repeats the filter
    // so an item can never be read through a plan that changed clinics under it.
    const itemRows =
      planIds.length === 0
        ? []
        : this.db
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
            .orderBy(asc(treatmentPlanItems.id))
            .all();

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
    const plan = this.db
      .select()
      .from(treatmentPlans)
      .where(
        and(
          eq(treatmentPlans.clinicId, clinicId),
          eq(treatmentPlans.patientId, patientId),
          eq(treatmentPlans.id, id),
        ),
      )
      .get();

    if (!plan) {
      return undefined;
    }

    const itemRows = this.db
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
      .orderBy(asc(treatmentPlanItems.id))
      .all();

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
   * Upsert the plan and each of its lines, in one transaction — the PostgreSQL
   * twin's kit with the driver's own shape.
   *
   * The transaction is the driver's `db.transaction()` around a **synchronous**
   * callback: every statement is a `.run()` with no `await`, so better-sqlite3 can
   * wrap them in `BEGIN`/`COMMIT` on this one connection. `clinic_id` and
   * `patient_id` are written on insert but left out of the conflict set, so a save
   * can never move a plan between tenants; `created_at` is the column's default and
   * is never touched; no item is deleted, because `visit_treatment_executions`
   * references it (`ON DELETE SET NULL` would unlink a performed treatment from the
   * line that named it).
   */
  async save(plan: TreatmentPlanWriteModel): Promise<void> {
    try {
      this.db.transaction((tx) => {
        tx.insert(treatmentPlans)
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
          })
          .run();

        for (const item of plan.items) {
          tx.insert(treatmentPlanItems)
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
            })
            .run();
        }
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${plan.patientId} was not found`, {
          entity: 'Patient',
          id: plan.patientId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
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
