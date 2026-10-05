import type { CurrencyCode, TimeZone } from '@denti-code-u3/types';
import { clinicLocalMoment, parseLocalTimeMinutes } from '../shared/time.js';
import { DomainError } from '../shared/errors.js';

export interface ClinicOperatingHours {
  /** 1 = Monday … 7 = Sunday, ISO-8601 ordering. */
  readonly weekday: number;
  readonly opensAtLocalTime: string;
  readonly closesAtLocalTime: string;
  readonly isClosed: boolean;
}

export interface Clinic {
  readonly id: string;
  readonly name: string;
  readonly legalName?: string;
  readonly timeZone: TimeZone;
  readonly currency: CurrencyCode;
  readonly operatingHours: readonly ClinicOperatingHours[];
  readonly settings: Readonly<Record<string, unknown>>;
}

export function isValidTimeZone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(candidate: string): void {
  if (!isValidTimeZone(candidate)) {
    throw new DomainError('INVALID_INPUT', `"${candidate}" is not a valid IANA time zone`, {
      timeZone: candidate,
    });
  }
}

export function operatingHoursFor(clinic: Clinic, weekday: number): ClinicOperatingHours {
  const hours = clinic.operatingHours.find((candidate) => candidate.weekday === weekday);
  if (!hours || hours.isClosed) {
    throw new DomainError('OUTSIDE_OPERATING_HOURS', `The clinic is closed on weekday ${weekday}`, {
      clinicId: clinic.id,
      weekday,
    });
  }
  return hours;
}

/**
 * The clinic's opening hours on the day an instant falls in the clinic's own zone.
 *
 * Returns `undefined` for a day with no hours row at all, which is different from
 * a row that says `isClosed`. A clinic that has never been configured for Sundays
 * is a configuration gap; one that has is telling us it is shut. Both refuse the
 * booking, but only the second is worth telling a receptionist about as a
 * scheduling fact rather than a setup one.
 */
export function operatingHoursOn(clinic: Clinic, instant: Date): ClinicOperatingHours | undefined {
  return clinic.operatingHours.find(
    (hours) => hours.weekday === clinicLocalMoment(instant, clinic.timeZone).weekday,
  );
}

/**
 * Asserts an interval lies wholly within one clinic-local day's opening hours.
 *
 * The rule is about the *interval*, not the start: a 17:00 appointment at a clinic
 * that closes at 17:00 is fine, and a 16:30 one-hour appointment at the same
 * clinic is not. Checking only the start is the mistake this function exists to
 * prevent — it is what lets a booking straddle closing time, which on a working
 * agenda is the same as a dentist who is still in the chair at 18:00.
 *
 * The comparison is on the clinic's wall clock, so it is unaffected by the offset
 * of the stored UTC instant and follows the clinic through daylight-saving
 * transitions rather than through the server's.
 */
export function assertWithinOperatingHours(clinic: Clinic, startsAt: Date, endsAt: Date): void {
  const localStart = clinicLocalMoment(startsAt, clinic.timeZone);
  const hours = operatingHoursOn(clinic, startsAt);

  if (!hours || hours.isClosed) {
    throw new DomainError(
      'OUTSIDE_OPERATING_HOURS',
      `The clinic is closed on ${localStart.localDate}`,
      { clinicId: clinic.id, localDate: localStart.localDate, weekday: localStart.weekday },
    );
  }

  const opensAtMinutes = parseLocalTimeMinutes(hours.opensAtLocalTime);
  const closesAtMinutes = parseLocalTimeMinutes(hours.closesAtLocalTime);
  if (opensAtMinutes === undefined || closesAtMinutes === undefined) {
    throw new DomainError(
      'OUTSIDE_OPERATING_HOURS',
      'The clinic has opening hours this day that cannot be read',
      { clinicId: clinic.id, weekday: localStart.weekday },
    );
  }

  if (localStart.minutesSinceMidnight < opensAtMinutes) {
    throw new DomainError(
      'OUTSIDE_OPERATING_HOURS',
      `The clinic opens at ${hours.opensAtLocalTime} on ${localStart.localDate}`,
      { clinicId: clinic.id, opensAtLocalTime: hours.opensAtLocalTime },
    );
  }

  // Read the end on the clinic's clock rather than adding minutes to the local
  // start: a booking that crosses midnight is as invalid in a 23:00 clinic as one
  // that overruns closing time, and the local day is the unit the hours are
  // expressed in.
  const localEnd = clinicLocalMoment(endsAt, clinic.timeZone);
  if (localEnd.localDate !== localStart.localDate) {
    throw new DomainError('OUTSIDE_OPERATING_HOURS', 'An appointment cannot run past midnight', {
      clinicId: clinic.id,
      localDate: localStart.localDate,
    });
  }

  // Half-open, like every other interval in the system: ending exactly at closing
  // time is legal and ending one minute after is not.
  if (localEnd.minutesSinceMidnight > closesAtMinutes) {
    throw new DomainError(
      'OUTSIDE_OPERATING_HOURS',
      `The appointment runs past the ${hours.closesAtLocalTime} closing time on ${localStart.localDate}`,
      { clinicId: clinic.id, closesAtLocalTime: hours.closesAtLocalTime },
    );
  }
}
