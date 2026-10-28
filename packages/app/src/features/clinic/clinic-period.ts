/**
 * A month-to-date period, read in the clinic's own calendar.
 *
 * Reports and the payment ledger both open on "this month so far". That is a
 * calendar question, not a reporting rule: the clinic's October is not UTC's
 * October, and `toISOString()` on the browser's instant would name the wrong day for
 * the last hours of every month. Keeping the arithmetic here means the two screens
 * cannot disagree about which dates they are asking for.
 */

export interface ClinicDatePeriod {
  readonly from: string;
  readonly to: string;
}

/** The clinic-local date `now` falls on, as `YYYY-MM-DD`. */
export function clinicDateIso(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(now);
  } catch {
    // An invalid zone is configuration, not a report. UTC keeps the page usable
    // rather than taking the screen down; every time is still labelled by the API.
    return now.toISOString().slice(0, 10);
  }
}

/** The clinic-local month containing `now`, from its first day through today. */
export function defaultMonthToDatePeriod(now: Date, timeZone: string): ClinicDatePeriod {
  const today = clinicDateIso(now, timeZone);
  return { from: `${today.slice(0, 8)}01`, to: today };
}
