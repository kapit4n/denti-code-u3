/**
 * The reporting read store, on PostgreSQL (ADR 0025).
 *
 * Every statement is scoped by `clinic_id`; no method can answer for another
 * clinic even if it is handed a row id. The two money aggregates are deliberately
 * separate statements: joining invoices to allocations before summing would multiply
 * an invoice's total by the number of payments that touched it.
 */

import { and, asc, count, eq, gte, lt, ne, sql } from 'drizzle-orm';

import {
  appointments,
  charges,
  clinicOperatingHours,
  clinics,
  invoices,
  paymentAllocations,
  payments,
  visits,
} from '@denti-code-u3/database/schema';
import type { ClinicId, DentistId } from '@denti-code-u3/types';

import type { DashboardReportingSettings } from '../../../application/dashboard-read-store.js';
import type {
  AppointmentBreakdownRow,
  ProductionRow,
  ReportOperatingHours,
  ReportsReadStore,
} from '../../../application/reports-read-store.js';
import type { DentiDatabase } from './connection.js';

export class PostgresReportsReadStore implements ReportsReadStore {
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

  async readAppointmentBreakdown(
    clinicId: ClinicId,
    from: Date,
    to: Date,
    dentistId?: DentistId,
  ): Promise<ReadonlyArray<AppointmentBreakdownRow>> {
    return this.db
      .select({
        dentistId: appointments.dentistId,
        status: appointments.status,
        count: count(),
        minutes: sql<number>`coalesce(sum(${appointments.durationMinutes}), 0)::int`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          gte(appointments.startsAt, from),
          lt(appointments.startsAt, to),
          dentistId ? eq(appointments.dentistId, dentistId) : undefined,
        ),
      )
      .groupBy(appointments.dentistId, appointments.status)
      .orderBy(asc(appointments.dentistId), asc(appointments.status));
  }

  async readProductionByDentist(
    clinicId: ClinicId,
    from: Date,
    to: Date,
    dentistId?: DentistId,
  ): Promise<ReadonlyArray<ProductionRow>> {
    return this.db
      .select({
        dentistId: visits.dentistId,
        productionMinor: sql<number>`coalesce(sum(
          ${charges.unitPriceMinor} * ${charges.quantity} - ${charges.discountMinor}
        ), 0)::int`,
      })
      .from(charges)
      .leftJoin(visits, eq(visits.id, charges.visitId))
      .where(
        and(
          eq(charges.clinicId, clinicId),
          gte(charges.createdAt, from),
          lt(charges.createdAt, to),
          dentistId ? eq(visits.dentistId, dentistId) : undefined,
        ),
      )
      .groupBy(visits.dentistId)
      .orderBy(asc(visits.dentistId));
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

  async sumOutstanding(clinicId: ClinicId): Promise<number> {
    const [[billed], [allocated]] = await Promise.all([
      this.db
        .select({ totalMinor: sql<number>`coalesce(sum(${invoices.totalMinor}), 0)::int` })
        .from(invoices)
        .where(and(eq(invoices.clinicId, clinicId), ne(invoices.status, 'VOID'))),
      this.db
        .select({
          totalMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::int`,
        })
        .from(paymentAllocations)
        .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
        .where(and(eq(invoices.clinicId, clinicId), ne(invoices.status, 'VOID'))),
    ]);

    return Math.max(0, (billed?.totalMinor ?? 0) - (allocated?.totalMinor ?? 0));
  }

  async readOperatingHours(clinicId: ClinicId): Promise<ReadonlyArray<ReportOperatingHours>> {
    return this.db
      .select({
        dayOfWeek: clinicOperatingHours.dayOfWeek,
        opensAt: clinicOperatingHours.opensAt,
        closesAt: clinicOperatingHours.closesAt,
        breakStartsAt: clinicOperatingHours.breakStartsAt,
        breakEndsAt: clinicOperatingHours.breakEndsAt,
      })
      .from(clinicOperatingHours)
      .where(eq(clinicOperatingHours.clinicId, clinicId))
      .orderBy(asc(clinicOperatingHours.dayOfWeek));
  }
}
