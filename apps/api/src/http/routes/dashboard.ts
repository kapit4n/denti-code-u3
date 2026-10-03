/**
 * Dashboard read model.
 *
 * Every figure on the dashboard is computed here, in the API, from the clinic's
 * own rows — never in a React component and never from a stored counter. The
 * UI only formats what this file returns, which is what makes the Milestone 3
 * exit criterion ("every metric is a query against the API, computed by the
 * API from the domain") true rather than aspirational.
 *
 * **Clinic scoping (ADR 0014).** Every query filters on `clinicId`. The value
 * arrives as an explicit argument and is never read from global state, so the
 * scoping is visible at every call site and testable. A missing filter here
 * would leak one clinic's patients to another, so it is not optional.
 *
 * **Money.** Amounts are integers in the currency's minor unit, per
 * `packages/domain/src/billing/money.ts`. This file returns minor units and
 * names the fields `...Minor`; converting to a decimal string is the UI's job
 * and must use the domain's formatter, never float arithmetic.
 */

import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import {
  // Aliased because `appointments` is the repository dependency in this file's
  // scope. Only the calendar preview still needs the table: it groups a month of
  // bookings in SQL, which is a reporting aggregate rather than an agenda read.
  appointments as appointmentsTable,
  clinicOperatingHours,
  clinics,
  dentists,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
} from '@denti-code-u3/database/schema';
import {
  CAPACITY_OCCUPYING_STATUSES,
  minutesBookedWithin,
  resolveClinicTimeWindow,
  type ClinicTimeWindow,
} from '../../application/clinic-time-window.js';
import type { AppointmentRepository } from '@denti-code-u3/domain';
import type { ClinicId, IsoDateTime } from '@denti-code-u3/types';
import type { DentiDatabase } from '../../infrastructure/persistence/postgres/connection.js';

/**
 * Treatment plans whose items represent work the patient still owes.
 *
 * The appointment statuses that occupy a chair live next to the window arithmetic
 * in the application layer, with the minute accounting that uses them.
 */

const OPEN_TREATMENT_PLAN_STATUSES = ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS'] as const;

export interface DashboardDependencies {
  /**
   * Still the raw connection, for the aggregates that have no port yet: patient
   * and treatment-plan counts, revenue, and the capacity the occupancy rate is
   * measured against. Appointments do not belong to that list any more — they are
   * read through `appointments`, so "today's book" is one query shared with the
   * agenda rather than a second implementation of it.
   */
  readonly db: DentiDatabase;
  /** The clinic's book, read through the same repository the agenda uses. */
  readonly appointments: AppointmentRepository;
  /**
   * Fallback IANA zone, used only when the clinic row cannot be read. The clinic
   * record is authoritative: two clinics on one API must not share a timezone just
   * because the process was started with one value.
   */
  readonly fallbackTimeZone: string;
}

interface ClinicReportingSettings {
  readonly timeZone: string;
  readonly currencyCode: string | null;
}

/**
 * Timezone and currency for the reporting period.
 *
 * Read from the clinic row rather than taken from configuration so the money is
 * labelled in the clinic's own currency and the day boundaries match the clinic's
 * own calendar.
 */
async function readClinicSettings(
  db: DentiDatabase,
  clinicId: string,
  fallbackTimeZone: string,
): Promise<ClinicReportingSettings> {
  const [clinic] = await db
    .select({ timeZone: clinics.timeZone, currencyCode: clinics.currencyCode })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  return {
    timeZone: clinic?.timeZone ?? fallbackTimeZone,
    currencyCode: clinic?.currencyCode ?? null,
  };
}

/**
 * Today's appointments in clinic time, read through the agenda repository.
 *
 * The dashboard is the first consumer of the agenda query, and the reason it is
 * not a second one: the window is resolved in the clinic's own timezone by
 * `resolveClinicTimeWindow`, then handed to the same `findAgenda` the calendar
 * calls. The dashboard's "today" and the agenda's "today" cannot drift, because
 * they are one query with two windows.
 */
async function readAppointmentsInWindow(
  appointments: AppointmentRepository,
  clinicId: ClinicId,
  window: ClinicTimeWindow,
) {
  return appointments.findAgenda(clinicId, {
    from: window.start.toISOString() as IsoDateTime,
    to: window.end.toISOString() as IsoDateTime,
  });
}

/**
 * Share of today's bookable capacity that is actually booked.
 *
 * Capacity is derived from real data rather than a constant: every active
 * dentist in the clinic multiplied by the minutes the clinic is open on today's
 * weekday, minus the lunch break. A clinic with no recorded opening hours has
 * unknown capacity, so the rate is `null` — the UI shows "—" instead of a
 * confident `0%`, which would read as "nobody is working today".
 */
async function readOccupancyRate(
  db: DentiDatabase,
  clinicId: string,
  window: ClinicTimeWindow,
  bookedMinutes: number,
): Promise<number | null> {
  const [[hours], [dentistRow]] = await Promise.all([
    db
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
          eq(clinicOperatingHours.dayOfWeek, window.dayOfWeek),
        ),
      )
      .limit(1),
    db
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
  if (capacityMinutes === 0) {
    return null;
  }

  return Math.round((bookedMinutes / capacityMinutes) * 100);
}

/** `HH:MM` (as PostgreSQL `time`) to minutes since midnight. */
function minutesBetween(from: string, to: string): number {
  const [fromHour = 0, fromMinute = 0] = from.split(':').map(Number);
  const [toHour = 0, toMinute = 0] = to.split(':').map(Number);
  return toHour * 60 + toMinute - (fromHour * 60 + fromMinute);
}

export async function registerDashboardRoutes(
  app: FastifyInstance,
  { db, appointments, fallbackTimeZone }: DashboardDependencies,
): Promise<void> {
  app.get('/api/v1/dashboard/stats', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const settings = await readClinicSettings(db, clinicId, fallbackTimeZone);
      const window = resolveClinicTimeWindow(new Date(), settings.timeZone);
      const todayAppointments = await readAppointmentsInWindow(appointments, clinicId, window);

      const byStatus = (statuses: readonly string[]) =>
        todayAppointments.filter((appointment) => statuses.includes(appointment.status));

      const bookedMinutes = minutesBookedWithin(todayAppointments, window);

      const [[patientTotals], [pendingTreatmentTotals], [revenueRow], occupancyRate] =
        await Promise.all([
          db
            .select({ total: count() })
            .from(patients)
            .where(and(eq(patients.clinicId, clinicId), eq(patients.isActive, true))),
          db
            .select({ total: count() })
            .from(treatmentPlanItems)
            .innerJoin(treatmentPlans, eq(treatmentPlans.id, treatmentPlanItems.treatmentPlanId))
            .where(
              and(
                eq(treatmentPlans.clinicId, clinicId),
                eq(treatmentPlanItems.isCompleted, false),
                inArray(treatmentPlans.status, [...OPEN_TREATMENT_PLAN_STATUSES]),
              ),
            ),
          db
            .select({ totalMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int` })
            .from(payments)
            .where(
              and(
                eq(payments.clinicId, clinicId),
                gte(payments.receivedAt, window.startOfMonth),
                lt(payments.receivedAt, window.startOfNextMonth),
              ),
            ),
          readOccupancyRate(db, clinicId, window, bookedMinutes),
        ]);

      return {
        today: {
          appointments: todayAppointments.length,
          completed: byStatus(['COMPLETED']).length,
          pending: byStatus(['SCHEDULED', 'CONFIRMED']).length,
          inTreatment: byStatus(['ARRIVED', 'IN_TREATMENT']).length,
          cancelled: byStatus(['CANCELLED']).length,
          noShow: byStatus(['NO_SHOW']).length,
        },
        clinic: {
          activePatients: patientTotals?.total ?? 0,
          pendingTreatmentItems: pendingTreatmentTotals?.total ?? 0,
          /** Minor units of `currencyCode`. See the module comment. */
          collectedThisMonthMinor: revenueRow?.totalMinor ?? 0,
          currencyCode: settings.currencyCode,
          /** `null` when today's capacity is unknown; never a fabricated `0`. */
          occupancyRate,
        },
      };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to build the dashboard read model');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch dashboard statistics',
          requestId: request.id,
        },
      });
    }
  });

  app.get('/api/v1/dashboard/today-appointments', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const settings = await readClinicSettings(db, clinicId, fallbackTimeZone);
      const window = resolveClinicTimeWindow(new Date(), settings.timeZone);
      const entries = await readAppointmentsInWindow(appointments, clinicId, window);

      // The existing response shape is kept rather than replaced: this endpoint's
      // shape is a UI contract with passing e2e specs, and reshaping it is not what
      // moving the query behind a repository is for.
      return {
        items: entries.map((entry) => ({
          id: entry.id,
          startsAt: entry.startsAt,
          durationMinutes: entry.durationMinutes,
          status: entry.status,
          dentistId: entry.dentistId,
          firstName: entry.patientFirstName,
          lastName: entry.patientLastName,
        })),
      };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read today appointments');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch today appointments',
          requestId: request.id,
        },
      });
    }
  });

  app.get('/api/v1/dashboard/upcoming-visits', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      // "Upcoming" starts now and reaches a year out, so a clinic with nothing
      // booked tomorrow still shows its next real work rather than an empty list.
      const from = new Date();
      const entries = await appointments.findAgenda(clinicId, {
        from: from.toISOString() as IsoDateTime,
        to: new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString() as IsoDateTime,
      });

      // Cancelled work is not upcoming work. The repository returns it because the
      // calendar must show that a slot is deliberately empty; this list is a
      // different question, so it answers it here.
      const items = entries
        .filter((entry) => entry.status !== 'CANCELLED')
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          startsAt: entry.startsAt,
          durationMinutes: entry.durationMinutes,
          status: entry.status,
          firstName: entry.patientFirstName,
          lastName: entry.patientLastName,
        }));

      return { items };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read upcoming visits');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch upcoming visits',
          requestId: request.id,
        },
      });
    }
  });

  app.get('/api/v1/dashboard/recent-patients', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const items = await db
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
        .limit(8);

      return { items };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read recent patients');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch recent patients',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * A compact per-day booking count for the dashboard's calendar preview.
   *
   * Grouping happens in SQL so the API returns one row per day instead of
   * shipping every appointment of the month to the browser to count there.
   */
  app.get('/api/v1/dashboard/calendar-preview', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const query = request.query as { days?: string };

    try {
      const requested = Number(query.days ?? 14);
      // Bounded so a crafted `?days=` cannot ask for the whole table.
      const days = Number.isFinite(requested)
        ? Math.min(60, Math.max(1, Math.trunc(requested)))
        : 14;

      // Anchored to clinic-local midnight so the first day in the range is a
      // full day; a UTC anchor would show a partial first day for most clinics.
      const settings = await readClinicSettings(db, clinicId, fallbackTimeZone);
      const { start } = resolveClinicTimeWindow(new Date(), settings.timeZone);
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

      const items = await db
        .select({
          day: sql<string>`to_char(${appointmentsTable.startsAt} at time zone 'UTC', 'YYYY-MM-DD')`,
          total: count(),
          completed: sql<number>`count(*) filter (where ${appointmentsTable.status} = 'COMPLETED')::int`,
        })
        .from(appointmentsTable)
        .where(
          and(
            eq(appointmentsTable.clinicId, clinicId),
            gte(appointmentsTable.startsAt, start),
            lt(appointmentsTable.startsAt, end),
          ),
        )
        .groupBy(sql`to_char(${appointmentsTable.startsAt} at time zone 'UTC', 'YYYY-MM-DD')`)
        .orderBy(asc(sql`to_char(${appointmentsTable.startsAt} at time zone 'UTC', 'YYYY-MM-DD')`));

      return { from: start.toISOString(), to: end.toISOString(), days, items };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read the calendar preview');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch calendar preview',
          requestId: request.id,
        },
      });
    }
  });
}

/** Exported for tests: the enum members the capacity maths depends on. */
export const dashboardStatusAssumptions = {
  capacityOccupying: CAPACITY_OCCUPYING_STATUSES,
  openTreatmentPlans: OPEN_TREATMENT_PLAN_STATUSES,
} as const;
