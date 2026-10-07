/**
 * The dashboard read store, on PostgreSQL (ADR 0025).
 *
 * The dashboard route used to hold these seven queries itself, and four of them
 * still took the raw connection. They are engine-independent *questions* —
 * "how many patients, how much collected, what is today's capacity" — so they
 * moved behind `DashboardReadStore` and each engine answers its own copy. The
 * other half of the route (windows, minutes, response shapes) is plain
 * JavaScript and stays in the route, shared by both engines.
 */

import { and, asc, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import {
  appointments as appointmentsTable,
  clinicOperatingHours,
  clinics,
  dentists,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
} from '@denti-code-u3/database/schema';
import type { ClinicId } from '@denti-code-u3/types';

import {
  minutesBetween,
  OPEN_TREATMENT_PLAN_STATUSES,
  type CalendarPreviewDay,
  type DashboardReadStore,
  type DashboardReportingSettings,
  type RecentPatient,
} from '../../../application/dashboard-read-store.js';
import type { DentiDatabase } from './connection.js';

/**
 * The dashboard read store for the PostgreSQL engine.
 *
 * `fallbackTimeZone` is applied only when the clinic row cannot be read: the
 * clinic's own `time_zone` column is authoritative (see `clinic-repository.ts`).
 */
export class PostgresDashboardReadStore implements DashboardReadStore {
  constructor(
    private readonly db: DentiDatabase,
    private readonly fallbackTimeZone: string,
  ) {}

  async readClinicSettings(clinicId: ClinicId): Promise<DashboardReportingSettings> {
    const [clinic] = await this.db
      .select({ timeZone: clinics.timeZone, currencyCode: clinics.currencyCode })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    return {
      timeZone: clinic?.timeZone ?? this.fallbackTimeZone,
      currencyCode: clinic?.currencyCode ?? null,
    };
  }

  async countActivePatients(clinicId: ClinicId): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(patients)
      .where(and(eq(patients.clinicId, clinicId), eq(patients.isActive, true)));

    return row?.total ?? 0;
  }

  async countOpenTreatmentItems(clinicId: ClinicId): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(treatmentPlanItems)
      .innerJoin(treatmentPlans, eq(treatmentPlans.id, treatmentPlanItems.treatmentPlanId))
      .where(
        and(
          eq(treatmentPlans.clinicId, clinicId),
          eq(treatmentPlanItems.isCompleted, false),
          inArray(treatmentPlans.status, [...OPEN_TREATMENT_PLAN_STATUSES]),
        ),
      );

    return row?.total ?? 0;
  }

  async sumPaymentsInWindow(clinicId: ClinicId, from: Date, to: Date): Promise<number> {
    const [row] = await this.db
      .select({ totalMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int` })
      .from(payments)
      .where(
        and(
          eq(payments.clinicId, clinicId),
          gte(payments.receivedAt, from),
          lt(payments.receivedAt, to),
        ),
      );

    return row?.totalMinor ?? 0;
  }

  async readCapacityMinutes(clinicId: ClinicId, dayOfWeek: number): Promise<number | null> {
    const [[hours], [dentistRow]] = await Promise.all([
      this.db
        .select({
          opensAt: clinicOperatingHours.opensAt,
          closesAt: clinicOperatingHours.closesAt,
          breakStartsAt: clinicOperatingHours.breakStartsAt,
          breakEndsAt: clinicOperatingHours.breakEndsAt,
        })
        .from(clinicOperatingHours)
        .where(
          and(
            eq(clinicOperatingHours.clinicId, clinicId),
            eq(clinicOperatingHours.dayOfWeek, dayOfWeek),
          ),
        )
        .limit(1),
      this.db
        .select({ total: count() })
        .from(dentists)
        .where(and(eq(dentists.clinicId, clinicId), eq(dentists.isActive, true))),
    ]);

    const dentistCount = dentistRow?.total ?? 0;
    if (dentistCount === 0 || !hours?.opensAt || !hours?.closesAt) {
      return null;
    }

    const openMinutes = minutesBetween(hours.opensAt, hours.closesAt);
    const breakMinutes =
      hours.breakStartsAt && hours.breakEndsAt
        ? minutesBetween(hours.breakStartsAt, hours.breakEndsAt)
        : 0;
    const capacityMinutes = Math.max(0, (openMinutes - breakMinutes) * dentistCount);

    return capacityMinutes === 0 ? null : capacityMinutes;
  }

  async recentPatients(clinicId: ClinicId, limit: number): Promise<ReadonlyArray<RecentPatient>> {
    return this.db
      .select({
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        recordNumber: patients.recordNumber,
        createdAt: patients.createdAt,
      })
      .from(patients)
      .where(and(eq(patients.clinicId, clinicId), eq(patients.isActive, true)))
      .orderBy(desc(patients.createdAt))
      .limit(limit);
  }

  async calendarPreview(
    clinicId: ClinicId,
    from: Date,
    to: Date,
  ): Promise<ReadonlyArray<CalendarPreviewDay>> {
    return this.db
      .select({
        day: sql<string>`to_char(${appointmentsTable.startsAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        total: count(),
        completed: sql<number>`count(*) filter (where ${appointmentsTable.status} = 'COMPLETED')::int`,
      })
      .from(appointmentsTable)
      .where(
        and(
          eq(appointmentsTable.clinicId, clinicId),
          gte(appointmentsTable.startsAt, from),
          lt(appointmentsTable.startsAt, to),
        ),
      )
      .groupBy(sql`to_char(${appointmentsTable.startsAt} at time zone 'UTC', 'YYYY-MM-DD')`)
      .orderBy(asc(sql`to_char(${appointmentsTable.startsAt} at time zone 'UTC', 'YYYY-MM-DD')`));
  }
}
