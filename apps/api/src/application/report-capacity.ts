/**
 * Capacity for a reporting period, computed from the clinic's own calendar.
 *
 * The dashboard answers "today's capacity" with one weekday row. A report spans
 * many days, so it counts how often each weekday occurs in the period and adds that
 * weekday's open minutes, minus its break, once per clinician available that day.
 *
 * A clinic with no recorded hours, or no clinician to fill them, has **unknown**
 * capacity (`null`) rather than zero. The distinction is the one the dashboard already
 * makes: an unknown denominator must render as an em dash, never as a confident `0%`.
 * A recorded closed day contributes zero, because "we are shut on Sunday" is a fact,
 * not missing data.
 */

import type { ClinicCalendarDay } from './clinic-time-window.js';
import { minutesBetween } from './dashboard-read-store.js';
import type { ReportOperatingHours } from './reports-read-store.js';

/**
 * Available minutes for `days`, given the clinic's weekly hours and how many
 * clinicians share them.
 *
 * @param days - every local day in the closed period
 * @param hours - the clinic's operating-hours rows
 * @param clinicianCount - active clinicians, or 1 when the report is filtered to one
 */
export function capacityMinutesForDays(
  days: readonly ClinicCalendarDay[],
  hours: readonly ReportOperatingHours[],
  clinicianCount: number,
): number | null {
  if (hours.length === 0 || clinicianCount <= 0 || days.length === 0) {
    return null;
  }

  const byDay = new Map(hours.map((row) => [row.dayOfWeek, row]));
  let capacityPerClinician = 0;

  for (const day of days) {
    const row = byDay.get(day.dayOfWeek);
    if (!row?.opensAt || !row.closesAt) {
      continue;
    }

    const openMinutes = minutesBetween(row.opensAt, row.closesAt);
    const breakMinutes =
      row.breakStartsAt && row.breakEndsAt ? minutesBetween(row.breakStartsAt, row.breakEndsAt) : 0;

    capacityPerClinician += Math.max(0, openMinutes - breakMinutes);
  }

  const total = capacityPerClinician * clinicianCount;
  return total === 0 ? null : total;
}

/** Percentage of capacity booked, or `null` when either side is unknown. */
export function occupancyRate(
  bookedMinutes: number,
  capacityMinutes: number | null,
): number | null {
  if (capacityMinutes === null || capacityMinutes === 0) {
    return null;
  }

  return Math.round((bookedMinutes / capacityMinutes) * 100);
}
