import type { IsoDateTime, TimeZone } from '@denti-code-u3/types';

export const MINUTE_IN_MS = 60_000;
export const HOUR_IN_MS = 60 * MINUTE_IN_MS;
export const DAY_IN_MS = 24 * HOUR_IN_MS;

export function addMinutes(isoInstant: IsoDateTime, minutes: number): IsoDateTime {
  return new Date(new Date(isoInstant).getTime() + minutes * MINUTE_IN_MS).toISOString();
}

export function durationInMinutes(fromIsoInstant: IsoDateTime, toIsoInstant: IsoDateTime): number {
  return Math.round(
    (new Date(toIsoInstant).getTime() - new Date(fromIsoInstant).getTime()) / MINUTE_IN_MS,
  );
}

/**
 * The UTC offset of `instant` in `timeZone`, in milliseconds.
 * Positive east of Greenwich, matching `Date.prototype.getTimezoneOffset`'s
 * negated sign.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: TimeZone): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : Number.NaN;
  };

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );

  return asIfUtc - instant.getTime();
}

/**
 * The instant of local midnight for `isoDate` in `clinicTimeZone`.
 *
 * Offset is resolved twice because a timezone's offset can depend on the instant
 * itself (daylight saving transitions). The first pass gets the offset at the
 * naive instant, the second pass corrects it against the corrected instant.
 */
function localMidnightUtc(isoDate: string, clinicTimeZone: TimeZone): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    throw new RangeError(`Expected an ISO calendar date (YYYY-MM-DD), received "${isoDate}"`);
  }

  const naiveMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstPass = new Date(
    naiveMidnight - timeZoneOffsetMs(new Date(naiveMidnight), clinicTimeZone),
  );
  return new Date(naiveMidnight - timeZoneOffsetMs(firstPass, clinicTimeZone));
}

/**
 * The half-open interval `[startsAt, endsAt)` covering one clinic-local day.
 *
 * Half-open intervals are the correct way to express ranges: a day query
 * includes an appointment at 23:59 and excludes one at 00:00 the next day,
 * without an off-by-one boundary condition.
 *
 * A day is always 24 hours long here. On a daylight-saving transition day the
 * local day is 23 or 25 hours, and the interval is anchored at local midnight
 * plus 24 hours so that scheduling stays predictable for the clinic.
 */
export function clinicDayBounds(
  isoDate: string,
  clinicTimeZone: TimeZone,
): { readonly startsAt: IsoDateTime; readonly endsAt: IsoDateTime } {
  const startsAt = localMidnightUtc(isoDate, clinicTimeZone);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + DAY_IN_MS).toISOString(),
  };
}

/** `true` when `isoInstant` falls inside the half-open interval. */
export function isWithinRange(
  isoInstant: IsoDateTime,
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
): boolean {
  const instant = new Date(isoInstant).getTime();
  return instant >= new Date(startsAt).getTime() && instant < new Date(endsAt).getTime();
}

/** `true` when `[candidateStart, candidateEnd)` overlaps `[existingStart, existingEnd)`. */
export function intervalsOverlap(
  candidateStart: IsoDateTime,
  candidateEnd: IsoDateTime,
  existingStart: IsoDateTime,
  existingEnd: IsoDateTime,
): boolean {
  return (
    new Date(candidateStart).getTime() < new Date(existingEnd).getTime() &&
    new Date(candidateEnd).getTime() > new Date(existingStart).getTime()
  );
}

/**
 * An instant, as the clinic's wall clock reads it.
 *
 * The domain needs this to answer "is the clinic open then?", and that question
 * cannot be answered in UTC. A clinic in `America/Lima` is open at 14:00Z and
 * shut at 19:00Z; the same instants in `Europe/London` are the other way round,
 * and the answer changes again twice a year in the zones that observe daylight
 * saving. Working out the local reading from the instant — rather than trusting a
 * caller to send local times — is what keeps the rule honest.
 */
export interface ClinicLocalMoment {
  /** 1 = Monday … 7 = Sunday, ISO-8601, matching `ClinicOperatingHours.weekday`. */
  readonly weekday: number;
  /** Minutes since local midnight, `0 … 1439`. */
  readonly minutesSinceMidnight: number;
  /** `HH:MM`, the shape the operating-hours rows store. */
  readonly localTime: string;
  /** `YYYY-MM-DD`, the clinic-local calendar date. */
  readonly localDate: string;
}

/**
 * Reads an instant on the clinic's wall clock.
 *
 * Derived by shifting the instant by the zone's offset and then reading UTC
 * getters, which is the standard trick and needs no library. `weekday` is derived
 * from the shifted instant too, so it is the clinic's day rather than Greenwich's
 * — a booking at 02:00Z belongs to the previous day in Buenos Aires and the same
 * day in London, and opening hours for the wrong one would refuse a legitimate
 * early appointment.
 */
export function clinicLocalMoment(instant: Date, timeZone: TimeZone): ClinicLocalMoment {
  const offset = timeZoneOffsetMs(instant, timeZone);
  const local = new Date(instant.getTime() + offset);

  // `getUTCDay()` is 0 = Sunday … 6 = Saturday; the domain is 1 = Monday …
  // 7 = Sunday, so Sunday is the one value that needs shifting rather than adding.
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const minutesSinceMidnight = local.getUTCHours() * 60 + local.getUTCMinutes();

  return {
    weekday,
    minutesSinceMidnight,
    localTime: `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`,
    localDate: local.toISOString().slice(0, 10),
  };
}

/**
 * `HH:MM` as minutes since midnight, or `undefined` when unparseable.
 *
 * `undefined` rather than a throw: operating hours come from the clinic's own
 * record, and a row a human typed wrong should make one appointment fail, not
 * crash the request that read it.
 */
export function parseLocalTimeMinutes(localTime: string): number | undefined {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(localTime);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return undefined;
  }

  return hours * 60 + minutes;
}
