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
 *
 * **The queries live behind `DashboardReadStore` (ADR 0025).** The four
 * helpers this file used to assemble out of a raw connection were the same
 * engine-independent questions the SQLite engine asks, so they moved behind
 * one port with two implementations (`postgres/dashboard-store.ts`,
 * `sqlite/dashboard-store.ts`). All seven reading endpoints read through the
 * port; what stays here is the engine-neutral half — windows, minutes,
 * response shapes — which is exactly the half a second engine would reuse.
 */

import type { FastifyInstance } from 'fastify';

import {
  CAPACITY_OCCUPYING_STATUSES,
  minutesBookedWithin,
  resolveClinicTimeWindow,
  type ClinicTimeWindow,
} from '../../application/clinic-time-window.js';
import {
  OPEN_TREATMENT_PLAN_STATUSES,
  type DashboardReadStore,
} from '../../application/dashboard-read-store.js';
import type { AppointmentRepository } from '@denti-code-u3/domain';
import type { ClinicId, IsoDateTime } from '@denti-code-u3/types';

export interface DashboardDependencies {
  /** Every aggregate on the dashboard, on whichever engine answered. */
  readonly dashboard: DashboardReadStore;
  /** The clinic's book, read through the same repository the agenda uses. */
  readonly appointments: AppointmentRepository;
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

export async function registerDashboardRoutes(
  app: FastifyInstance,
  { dashboard, appointments }: DashboardDependencies,
): Promise<void> {
  app.get('/api/v1/dashboard/stats', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const settings = await dashboard.readClinicSettings(clinicId);
      const window = resolveClinicTimeWindow(new Date(), settings.timeZone);
      const todayAppointments = await readAppointmentsInWindow(appointments, clinicId, window);

      const byStatus = (statuses: readonly string[]) =>
        todayAppointments.filter((appointment) => statuses.includes(appointment.status));

      const bookedMinutes = minutesBookedWithin(todayAppointments, window);

      const [activePatients, pendingTreatmentItems, collectedThisMonth, capacityMinutes] =
        await Promise.all([
          dashboard.countActivePatients(clinicId),
          dashboard.countOpenTreatmentItems(clinicId),
          dashboard.sumPaymentsInWindow(clinicId, window.startOfMonth, window.startOfNextMonth),
          dashboard.readCapacityMinutes(clinicId, window.dayOfWeek),
        ]);

      const occupancyRate =
        capacityMinutes === null || capacityMinutes === 0
          ? null
          : Math.round((bookedMinutes / capacityMinutes) * 100);

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
          activePatients,
          pendingTreatmentItems,
          /** Minor units of `currencyCode`. See the module comment. */
          collectedThisMonthMinor: collectedThisMonth,
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
      const settings = await dashboard.readClinicSettings(clinicId);
      const window = resolveClinicTimeWindow(new Date(), settings.timeZone);
      const entries = await readAppointmentsInWindow(appointments, clinicId, window);

      // The existing response shape is kept rather than replaced: this endpoint's
      // shape is a UI contract with passing e2e specs, and reshaping it is not what
      // moving the query behind the agenda repository is for.
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
      const patients = await dashboard.recentPatients(clinicId, 8);
      return { items: patients };
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
      const settings = await dashboard.readClinicSettings(clinicId);
      const { start } = resolveClinicTimeWindow(new Date(), settings.timeZone);
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

      const items = await dashboard.calendarPreview(clinicId, start, end);

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
