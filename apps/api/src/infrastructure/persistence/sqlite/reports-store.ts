/**
 * The reporting read store, on SQLite (ADR 0025).
 *
 * The twin of `postgres/reports-store.ts`. The same questions, the same clinic
 * scoping, and the same two-statement outstanding calculation. SQLite has no
 * `::int` cast, so these sums are already numbers; the group-by shape and the
 * half-open window are identical.
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
} from '@denti-code-u3/database/schema/sqlite';
import type { ClinicId, DentistId } from '@denti-code-u3/types';

import type { DashboardReportingSettings } from '../../../application/dashboard-read-store.js';
import type {
  AppointmentBreakdownRow,
  ProductionRow,
  ReportOperatingHours,
  ReportsReadStore,
} from '../../../application/reports-read-store.js';
import type { SqliteDatabase } from './connection.js';

export class SQLiteReportsReadStore implements ReportsReadStore {
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
        minutes: sql<number>`coalesce(sum(${appointments.durationMinutes}), 0)`,
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
        ), 0)`,
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

  async sumOutstanding(clinicId: ClinicId): Promise<number> {
    const [[billed], [allocated]] = await Promise.all([
      this.db
        .select({ totalMinor: sql<number>`coalesce(sum(${invoices.totalMinor}), 0)` })
        .from(invoices)
        .where(and(eq(invoices.clinicId, clinicId), ne(invoices.status, 'VOID'))),
      this.db
        .select({
          totalMinor: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)`,
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
