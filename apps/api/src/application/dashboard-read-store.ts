/**
 * The dashboard's read store — one port, two engine implementations.
 *
 * ADR 0025 keeps the two engines as two implementations of one set of ports:
 * the PostgreSQL repository lives beside the SQLite repository, and neither
 * knows the other exists. The dashboard route is the engine-neutral half — it
 * computes windows and minutes and response shapes in plain JavaScript and asks
 * this port for everything that touches a table. The two implementations
 * (`postgres/dashboard-store.ts`, `sqlite/dashboard-store.ts`) answer the same
 * questions against their own schemas.
 *
 * This is a read-model port, not a domain rule, so it is declared here in the
 * application layer rather than in `packages/domain` — the domain has nothing
 * to say about how many appointments a clinic booked today. It stays out of
 * the route module so the route keeps none of the two engines' columns.
 */

import type { ClinicId } from '@denti-code-u3/types';

/**
 * Treatment plans whose items represent work the patient still owes.
 *
 * "Open" means the plan has not been rejected or closed; a `CANCELLED` or
 * `COMPLETED` plan contributes nothing to the outstanding count regardless of
 * what its items say.
 */
export const OPEN_TREATMENT_PLAN_STATUSES = ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS'] as const;

/** Timezone and currency for the reporting period, read from the clinic row. */
export interface DashboardReportingSettings {
  readonly timeZone: string;
  readonly currencyCode: string | null;
}

/** One row of the "recent patients" list. `createdAt` is a `Date` on both engines. */
export interface RecentPatient {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly recordNumber: string | null;
  readonly createdAt: Date;
}

/** One day of the calendar preview: a UTC `YYYY-MM-DD` key with booking counts. */
export interface CalendarPreviewDay {
  readonly day: string;
  readonly total: number;
  readonly completed: number;
}

/**
 * The aggregates today's dashboard is made of.
 *
 * Every method is scoped to the clinic that asked (ADR 0014) — there is no
 * overload without a `ClinicId`. `calendarPreview` takes `[from, to)` as UTC
 * bounds so grouping can be a simple `strftime`/`to_char` on the stored column.
 */
export interface DashboardReadStore {
  readClinicSettings(clinicId: ClinicId): Promise<DashboardReportingSettings>;

  countActivePatients(clinicId: ClinicId): Promise<number>;

  /** Treatment-plan items that are not completed, on an open plan. */
  countOpenTreatmentItems(clinicId: ClinicId): Promise<number>;

  sumPaymentsInWindow(clinicId: ClinicId, from: Date, to: Date): Promise<number>;

  /**
   * Bookable minutes today: active dentists times (open − break) duration.
   *
   * `null` when the clinic has no recorded hours for that weekday or no active
   * dentists — the UI shows "—" instead of fabricating a confident `0%`.
   */
  readCapacityMinutes(clinicId: ClinicId, dayOfWeek: number): Promise<number | null>;

  recentPatients(clinicId: ClinicId, limit: number): Promise<ReadonlyArray<RecentPatient>>;

  calendarPreview(
    clinicId: ClinicId,
    from: Date,
    to: Date,
  ): Promise<ReadonlyArray<CalendarPreviewDay>>;
}

/** `HH:MM` → minutes since midnight. */
export function minutesBetween(from: string, to: string): number {
  const [fromHour = 0, fromMinute = 0] = from.split(':').map(Number);
  const [toHour = 0, toMinute = 0] = to.split(':').map(Number);
  return toHour * 60 + toMinute - (fromHour * 60 + fromMinute);
}
