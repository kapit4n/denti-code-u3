/**
 * Reports: appointments, production, collections, occupancy and clinician
 * performance for a clinic-local date period.
 *
 * Management reporting used to be a dangling sidebar row. This route is the read
 * model behind it. The UI sends two **dates** and an optional dentist id; the API
 * resolves the dates in the clinic's own timezone, asks the reporting read store for
 * the rows, and assembles the response in plain JavaScript. That keeps the calendar
 * arithmetic and the definitions of each figure in one engine-neutral place, while
 * every table access stays behind `ReportsReadStore` (ADR 0025).
 *
 * **What each figure means, exactly:**
 *
 *  - *Appointments* are bookings that **start** in the period. The whole duration is
 *    counted once; periods are weeks or months, so clipping at a midnight edge would
 *    only lose work the period claims to contain.
 *  - *Production* is the net charge value raised in the period
 *    (`unit price × quantity − discount`), before tax. A clinic's own catalogue and
 *    visit billing already write these rows, so there is no second way to record
 *    work for reporting.
 *  - *Collections* is money received in the period. Payments carry no clinician, so
 *    this figure is never split by dentist — even when a dentist filter is active.
 *    Attributing it would be invention.
 *  - *Outstanding* is the clinic's open invoice value now, independent of the period:
 *    a report for last month should not pretend an unpaid invoice stopped existing.
 *  - *Occupancy* is the scheduled minutes of work (completed included, cancelled and
 *    no-show excluded) over the clinic's recorded capacity for the period. Capacity
 *    is the open minutes less any break, times the active clinicians — or one when
 *    the report is filtered to one clinician. With no recorded hours it is `null`,
 *    and the UI must render an em dash rather than `0%`.
 *  - *Clinician performance* is the same appointment and production numbers grouped
 *    by the clinician the row names. Charges filed without a visit have no clinician
 *    and appear under `null`, labelled "Unassigned" rather than given to someone.
 */

import type { FastifyInstance } from 'fastify';

import type { Clock, DentistRepository } from '@denti-code-u3/domain';
import { DomainError } from '@denti-code-u3/domain';
import { reportRangeQuerySchema } from '@denti-code-u3/validation';
import { asDentistId, type ClinicId } from '@denti-code-u3/types';

import { resolveClinicDateRange } from '../../application/clinic-time-window.js';
import { CAPACITY_OCCUPYING_STATUSES } from '../../application/clinic-time-window.js';
import { capacityMinutesForDays, occupancyRate } from '../../application/report-capacity.js';
import type {
  AppointmentBreakdownRow,
  ReportsReadStore,
} from '../../application/reports-read-store.js';
import { sendProblem } from '../problem.js';

export interface ReportsDependencies {
  readonly reports: ReportsReadStore;
  /** Names and active status for the performance rows and the capacity denominator. */
  readonly dentists: DentistRepository;
  readonly clock: Clock;
}

/**
 * The widest period one request may ask for.
 *
 * A year is enough to see a trend and small enough that a crafted query string cannot
 * turn a report into a table scan over every appointment the clinic ever had.
 */
export const MAX_REPORT_DAYS = 366;

/** Statuses that occupy a chair for occupancy, including work already completed. */
const OCCUPANCY_STATUSES = [...CAPACITY_OCCUPYING_STATUSES, 'COMPLETED'] as const;

interface AppointmentTotals {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  pending: number;
  inTreatment: number;
  bookedMinutes: number;
}

function emptyTotals(): AppointmentTotals {
  return {
    total: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    pending: 0,
    inTreatment: 0,
    bookedMinutes: 0,
  };
}

function addAppointmentRow(totals: AppointmentTotals, row: AppointmentBreakdownRow): void {
  totals.total += row.count;

  switch (row.status) {
    case 'COMPLETED':
      totals.completed += row.count;
      break;
    case 'CANCELLED':
      totals.cancelled += row.count;
      break;
    case 'NO_SHOW':
      totals.noShow += row.count;
      break;
    case 'SCHEDULED':
    case 'CONFIRMED':
      totals.pending += row.count;
      break;
    case 'ARRIVED':
    case 'IN_TREATMENT':
      totals.inTreatment += row.count;
      break;
    default:
      break;
  }

  if ((OCCUPANCY_STATUSES as readonly string[]).includes(row.status)) {
    totals.bookedMinutes += row.minutes;
  }
}

export async function registerReportsRoutes(
  app: FastifyInstance,
  { reports, dentists, clock }: ReportsDependencies,
): Promise<void> {
  app.get(
    '/api/v1/reports/summary',
    { config: { permission: 'reports:read' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const parsed = reportRangeQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The report period could not be accepted',
            details: { issues: parsed.error.issues },
            requestId: request.id,
          },
        });
      }

      const { from, to, dentistId } = parsed.data;

      try {
        const settings = await reports.readClinicSettings(clinicId);
        const range = resolveClinicDateRange(from, to, settings.timeZone);

        if (range.days.length > MAX_REPORT_DAYS) {
          return reply.status(422).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: `A report may not span more than ${MAX_REPORT_DAYS} days`,
              requestId: request.id,
            },
          });
        }

        const selectedDentist = dentistId
          ? await dentists.findById(clinicId, asDentistId(dentistId))
          : undefined;

        if (dentistId && !selectedDentist) {
          throw new DomainError('NOT_FOUND', `Dentist ${dentistId} was not found`, {
            entity: 'Dentist',
            id: dentistId,
          });
        }

        const [allDentists, breakdown, productionRows, collectionsMinor, outstandingMinor, hours] =
          await Promise.all([
            dentists.listByClinic(clinicId),
            reports.readAppointmentBreakdown(clinicId, range.start, range.end, selectedDentist?.id),
            reports.readProductionByDentist(clinicId, range.start, range.end, selectedDentist?.id),
            reports.sumPaymentsInWindow(clinicId, range.start, range.end),
            reports.sumOutstanding(clinicId),
            reports.readOperatingHours(clinicId),
          ]);

        const activeDentistCount = allDentists.filter((dentist) => dentist.isActive).length;
        const capacityDentistCount = selectedDentist ? 1 : activeDentistCount;
        const capacityMinutes = capacityMinutesForDays(range.days, hours, capacityDentistCount);

        const appointments = emptyTotals();
        for (const row of breakdown) {
          addAppointmentRow(appointments, row);
        }

        const productionMinor = productionRows.reduce(
          (total, row) => total + row.productionMinor,
          0,
        );
        const performance = buildDentistPerformance({
          breakdown,
          productionRows,
          dentists: allDentists,
          selectedDentistId: selectedDentist?.id ?? null,
          capacityMinutes,
        });

        return {
          period: {
            from,
            to,
            timeZone: settings.timeZone,
            dentistId: selectedDentist?.id ?? null,
          },
          currencyCode: settings.currencyCode,
          appointments,
          production: { totalMinor: productionMinor },
          collections: { totalMinor: collectionsMinor },
          outstanding: { totalMinor: outstandingMinor },
          occupancy: {
            bookedMinutes: appointments.bookedMinutes,
            capacityMinutes,
            rate: occupancyRate(appointments.bookedMinutes, capacityMinutes),
          },
          dentists: performance,
          generatedAt: clock.now(),
        };
      } catch (error) {
        return sendProblem(reply, request, error, 'Failed to build the report');
      }
    },
  );
}

interface DentistPerformanceInput {
  readonly breakdown: ReadonlyArray<AppointmentBreakdownRow>;
  readonly productionRows: ReadonlyArray<{
    readonly dentistId: string | null;
    readonly productionMinor: number;
  }>;
  readonly dentists: ReadonlyArray<{
    readonly id: string;
    readonly fullName: string;
  }>;
  readonly selectedDentistId: string | null;
  readonly capacityMinutes: number | null;
}

function buildDentistPerformance({
  breakdown,
  productionRows,
  dentists,
  selectedDentistId,
  capacityMinutes,
}: DentistPerformanceInput) {
  const names = new Map(dentists.map((dentist) => [dentist.id, dentist.fullName]));
  const ids = new Set<string | null>();

  if (selectedDentistId) {
    ids.add(selectedDentistId);
  } else {
    for (const row of breakdown) {
      ids.add(row.dentistId);
    }
    for (const row of productionRows) {
      ids.add(row.dentistId);
    }
  }

  // A one-clinician denominator, whether or not the filter is active: a performance
  // row is one person's own share of the clinic's opening hours.
  const perDentistCapacity = capacityMinutes;

  return [...ids]
    .map((dentistId) => {
      const totals = emptyTotals();

      for (const row of breakdown) {
        if (row.dentistId === dentistId) {
          addAppointmentRow(totals, row);
        }
      }

      const productionMinor = productionRows
        .filter((row) => row.dentistId === dentistId)
        .reduce((total, row) => total + row.productionMinor, 0);

      return {
        dentistId,
        dentistName:
          dentistId === null ? 'Unassigned' : (names.get(dentistId) ?? 'Unknown clinician'),
        appointments: totals.total,
        completed: totals.completed,
        cancelled: totals.cancelled,
        noShow: totals.noShow,
        pending: totals.pending,
        inTreatment: totals.inTreatment,
        bookedMinutes: totals.bookedMinutes,
        productionMinor,
        capacityMinutes: perDentistCapacity,
        occupancyRate: occupancyRate(totals.bookedMinutes, perDentistCapacity),
      };
    })
    .sort((a, b) => {
      // Unassigned last: it is a bucket, not a person.
      if (a.dentistId === null) return 1;
      if (b.dentistId === null) return -1;
      return a.dentistName.localeCompare(b.dentistName);
    });
}
