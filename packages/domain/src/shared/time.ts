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
