/**
 * A report as a spreadsheet file.
 *
 * Export is a presentation concern: the API already computed every figure, and this
 * module does not recompute one. It writes the period, each clinic figure and the
 * per-clinician table in the order they appear on screen, so a manager who exports
 * and reads the file sees the same numbers.
 *
 * Money is written from the same integer minor units the API returns, through the
 * domain's `formatMinorUnits`, rather than divided by 100 here. A CSV is the one place
 * a hand-rolled rounding bug survives long enough to be filed as a tax document.
 */

import { formatMinorUnits } from '@denti-code-u3/domain';

import type { ReportSummary } from './queries/reports-query.js';

/** RFC 4180-style quoting: only when a value could otherwise shift a column. */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function money(minor: number, currencyCode: string | null): string {
  return `${formatMinorUnits(minor)}${currencyCode ? ` ${currencyCode}` : ''}`;
}

export function buildReportCsv(report: ReportSummary): string {
  const period = `${report.period.from} to ${report.period.to}`;
  const rows: (string | number)[][] = [
    ['Report', period],
    ['Clinic time zone', report.period.timeZone],
    ['Currency', report.currencyCode ?? ''],
    [],
    ['Metric', 'Value'],
    ['Appointments', report.appointments.total],
    ['Completed', report.appointments.completed],
    ['Cancelled', report.appointments.cancelled],
    ['No-show', report.appointments.noShow],
    ['Pending', report.appointments.pending],
    ['In treatment', report.appointments.inTreatment],
    ['Booked minutes', report.appointments.bookedMinutes],
    ['Production', money(report.production.totalMinor, report.currencyCode)],
    ['Collections', money(report.collections.totalMinor, report.currencyCode)],
    ['Outstanding', money(report.outstanding.totalMinor, report.currencyCode)],
    ['Occupancy', report.occupancy.rate === null ? 'Unknown' : `${report.occupancy.rate}%`],
    ['Capacity minutes', report.occupancy.capacityMinutes ?? 'Unknown'],
    [],
    [
      'Clinician',
      'Appointments',
      'Completed',
      'Cancelled',
      'No-show',
      'Pending',
      'In treatment',
      'Booked minutes',
      'Production',
      'Occupancy',
    ],
  ];

  for (const dentist of report.dentists) {
    rows.push([
      dentist.dentistName,
      dentist.appointments,
      dentist.completed,
      dentist.cancelled,
      dentist.noShow,
      dentist.pending,
      dentist.inTreatment,
      dentist.bookedMinutes,
      money(dentist.productionMinor, report.currencyCode),
      dentist.occupancyRate === null ? 'Unknown' : `${dentist.occupancyRate}%`,
    ]);
  }

  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

/** A file name a person can recognise in a downloads folder. */
export function reportFileName(report: ReportSummary): string {
  const dentist = report.period.dentistId ? '-clinician' : '';
  return `denti-code-report-${report.period.from}_${report.period.to}${dentist}.csv`;
}
