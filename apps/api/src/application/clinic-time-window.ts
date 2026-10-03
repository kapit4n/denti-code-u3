/**
 * Clinic-local calendar windows.
 *
 * `appointments.starts_at` is stored in UTC. "Today" for a clinic is a
 * *local* notion: a clinic in UTC-6 sees 18:00 local as 00:00 UTC the next day,
 * so a UTC-midnight window reports the wrong day's book for the last six hours
 * of every day. Every reporting window therefore has to be anchored to the
 * clinic's timezone, and the resulting instants converted back to UTC for the
 * query.
 *
 * This lives in the application layer on purpose: it is calendar arithmetic, not
 * SQL and not transport, and it is the part most likely to be wrong in a way that
 * is invisible until a clinic files a complaint.
 */

export interface ClinicTimeWindow {
  /** Clinic-local midnight of the current day, as a UTC instant. */
  readonly start: Date;
  /** Clinic-local midnight of the next day, as a UTC instant. */
  readonly end: Date;
  /** Clinic-local midnight on the first day of the current month. */
  readonly startOfMonth: Date;
  /** Clinic-local midnight on the first day of the next month. */
  readonly startOfNextMonth: Date;
  /**
   * Weekday of the current clinic-local day, 0 = Sunday, matching the
   * `day_of_week` column of `clinic_operating_hours`.
   */
  readonly dayOfWeek: number;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Reads the wall-clock time of `instant` as seen in `timeZone`. */
function wallClockIn(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) {
      throw new Error(`Intl did not report "${type}" for timezone "${timeZone}"`);
    }
    return Number(part.value);
  };

  return {
    year: read('year'),
    // Intl reports midnight as hour 24 in some ICU versions; normalise to 0.
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds.
 *
 * Derived by rendering the instant in the zone and reading the result back as if
 * it were UTC. The difference is the offset.
 */
function offsetMsAt(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Intl drops milliseconds, so compare against the truncated instant.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of local midnight on the given clinic-local date.
 *
 * The offset is sampled twice because the first guess can land on the far side
 * of a daylight-saving transition, which is exactly when a one-shot conversion
 * would silently shift the boundary by an hour.
 */
function clinicMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const naive = Date.UTC(year, month - 1, day);
  const firstGuess = new Date(naive - offsetMsAt(new Date(naive), timeZone));
  const refined = new Date(naive - offsetMsAt(firstGuess, timeZone));
  return refined;
}

/**
 * Resolves the reporting windows for `now` in the clinic's timezone.
 *
 * @param now - the instant to anchor on (injectable so tests are deterministic)
 * @param timeZone - IANA zone name, e.g. `America/Guatemala`
 */
export function resolveClinicTimeWindow(now: Date, timeZone: string): ClinicTimeWindow {
  const local = wallClockIn(now, timeZone);

  const start = clinicMidnightUtc(local.year, local.month, local.day, timeZone);
  const nextLocalDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  const end = clinicMidnightUtc(
    nextLocalDay.getUTCFullYear(),
    nextLocalDay.getUTCMonth() + 1,
    nextLocalDay.getUTCDate(),
    timeZone,
  );

  const startOfMonth = clinicMidnightUtc(local.year, local.month, 1, timeZone);
  const startOfNextMonth =
    local.month === 12
      ? clinicMidnightUtc(local.year + 1, 1, 1, timeZone)
      : clinicMidnightUtc(local.year, local.month + 1, 1, timeZone);

  // Weekday from the calendar date, not from the instant: 23:00 local on a
  // Sunday is already Monday in UTC, and operating hours must follow the clinic's
  // weekday, not the server's.
  const dayOfWeek = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();

  return { start, end, startOfMonth, startOfNextMonth, dayOfWeek };
}
