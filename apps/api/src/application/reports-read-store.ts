/**
 * The reporting read store — one port, two engine implementations.
 *
 * Reporting is a read model, not a domain rule. The route owns the meaning of a
 * "period" (clinic-local dates, resolved to a half-open UTC window), the money
 * fields and the response shape; this port owns every statement that touches a
 * table. That split is the same one the dashboard uses, and it is what lets the
 * SQLite and PostgreSQL twins answer identical questions without either engine
 * leaking into the route (ADR 0025).
 *
 * **Attribution is explicit.** Appointments and production carry a dentist id
 * because the rows they come from (appointments, and charges joined to their visit)
 * carry one. Payments do not, so collections are a clinic-period figure and are never
 * silently split across clinicians. A report that invented an attribution would be
 * worse than one that says "not attributable".
 */

import type { ClinicId, DentistId } from '@denti-code-u3/types';

import type { DashboardReportingSettings } from './dashboard-read-store.js';

/** One status's contribution to the appointment report. */
export interface AppointmentBreakdownRow {
  readonly dentistId: string | null;
  readonly status: string;
  readonly count: number;
  readonly minutes: number;
}

/** Net charge value attributed to one clinician. `null` means no visit/dentist. */
export interface ProductionRow {
  readonly dentistId: string | null;
  readonly productionMinor: number;
}

/** One weekday's opening hours, as stored on the clinic's own record. */
export interface ReportOperatingHours {
  readonly dayOfWeek: number;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly breakStartsAt: string | null;
  readonly breakEndsAt: string | null;
}

export interface ReportsReadStore {
  readClinicSettings(clinicId: ClinicId): Promise<DashboardReportingSettings>;

  /**
   * Appointment counts and scheduled minutes grouped by clinician and status.
   *
   * The window is half-open `[from, to)`. `minutes` is the whole booked duration for
   * an appointment that begins inside the window; a report is a period, not a day,
   * so clipping an appointment that starts before the first midnight would hide work
   * the period never claimed to contain.
   */
  readAppointmentBreakdown(
    clinicId: ClinicId,
    from: Date,
    to: Date,
    dentistId?: DentistId,
  ): Promise<ReadonlyArray<AppointmentBreakdownRow>>;

  /**
   * Net charge value (`unit price × quantity − discount`) raised in the window.
   *
   * Charges made through a visit are attributed to that visit's clinician. A charge
   * filed directly against a patient has no clinician and is reported as `null`
   * rather than assigned to whoever happened to be in the room.
   */
  readProductionByDentist(
    clinicId: ClinicId,
    from: Date,
    to: Date,
    dentistId?: DentistId,
  ): Promise<ReadonlyArray<ProductionRow>>;

  /** Money received in the window. Payments carry no clinician; see the module note. */
  sumPaymentsInWindow(clinicId: ClinicId, from: Date, to: Date): Promise<number>;

  /** Open invoice value across the clinic, regardless of the reporting period. */
  sumOutstanding(clinicId: ClinicId): Promise<number>;

  readOperatingHours(clinicId: ClinicId): Promise<ReadonlyArray<ReportOperatingHours>>;
}
