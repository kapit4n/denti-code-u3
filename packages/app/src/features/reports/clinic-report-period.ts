/**
 * The default reporting period, read in the clinic's own calendar.
 *
 * A report is about dates, not instants: "October" means the clinic's October. The
 * browser's `new Date()` is an instant and `toISOString()` is UTC, so on the evening
 * of the 31st in Lima it would name the 1st of the next month. The clinic's clock
 * answers the question the page is actually asking.
 *
 * The default is the current month to date: enough to be useful on the first visit,
 * short enough to stay inside the report's one-year limit, and it does not pretend to
 * know a financial year the clinic has not configured.
 */

export interface ReportPeriod {
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
export function defaultReportPeriod(now: Date, timeZone: string): ReportPeriod {
  const today = clinicDateIso(now, timeZone);
  return { from: `${today.slice(0, 8)}01`, to: today };
}
