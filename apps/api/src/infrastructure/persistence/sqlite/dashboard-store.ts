/**
 * The dashboard read store, on SQLite (ADR 0025).
 *
 * The twin of `postgres/dashboard-store.ts` — the same seven questions, one
 * answer per engine, with the two rendering SQLite requires:
 *
 *  - **The calendar day is `strftime('%Y-%m-%d', starts_at / 1000, 'unixepoch')`**
 *    instead of `to_char(... at time zone 'UTC')`. `starts_at` is epoch
 *    milliseconds, so the date is computed in UTC exactly like the PostgreSQL
 *    "`at time zone 'UTC'`" does; the division is exact because every
 *    `starts_at` this application writes is whole seconds.
 *  - **"Completed count per day" is a `sum(case …)` instead of a `FILTER`**
 *    clause, which SQLite does not support. The result is the same number.
 *  - **The revenue cast is gone.** PostgreSQL's `sum()` of an integer column
 *    needs `::int` only to undo its 64-bit return; SQLite's `sum()` already
 *    returns a number.
 *
 * The window math, the `HH:MM` ↔ minutes conversion and the `null`-when-unknown
 * capacity rules all come from the shared application layer and are identical.
 */

import { and, asc, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import {
  appointments,
  clinicOperatingHours,
  clinics,
  dentists,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
} from '@denti-code-u3/database/schema/sqlite';
import type { ClinicId } from '@denti-code-u3/types';

import {
  minutesBetween,
  OPEN_TREATMENT_PLAN_STATUSES,
  type CalendarPreviewDay,
  type DashboardReadStore,
  type DashboardReportingSettings,
  type RecentPatient,
} from '../../../application/dashboard-read-store.js';
import type { SqliteDatabase } from './connection.js';

/** The dashboard read store on the SQLite engine. */
export class SQLiteDashboardReadStore implements DashboardReadStore {
  constructor(
    private readonly db: SqliteDatabase,
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
      .select({ totalMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)` })
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
    // `starts_at` is epoch milliseconds; `/1000` is exact because every stored
    // time is whole seconds. Same UTC day as the PostgreSQL `at time zone
    // 'UTC'`. (The schema's `status` values travel as the raw domain strings,
    // including the `CHECK` enum guard they travel with on each engine.)
    return this.db
      .select({
        day: sql<string>`strftime('%Y-%m-%d', ${appointments.startsAt} / 1000, 'unixepoch')`,
        total: count(),
        // SQLite has no `FILTER` clause; `sum(case …)` is its portable twin.
        completed: sql<number>`sum(case when ${appointments.status} = 'COMPLETED' then 1 else 0 end)`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          gte(appointments.startsAt, from),
          lt(appointments.startsAt, to),
        ),
      )
      .groupBy(sql`strftime('%Y-%m-%d', ${appointments.startsAt} / 1000, 'unixepoch')`)
      .orderBy(asc(sql`strftime('%Y-%m-%d', ${appointments.startsAt} / 1000, 'unixepoch')`));
  }
}
