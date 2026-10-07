/**
 * Times as the clinic reads them.
 *
 * An instant is stored in UTC and has no opinion about where it is drawn. Everything
 * a receptionist reads off an appointment — "09:00", "Tuesday", "ends at 10:00" — is
 * a claim about the clinic's wall clock, so the clinic's IANA zone travels with every
 * call. `toLocaleString()` without a `timeZone` answers with the *visitor's* zone
 * instead, which is right for a timestamp in a log and wrong for a booking: a Lima
 * clinic's 09:00 becomes 10:00, or 08:00, for anyone whose machine is not on
 * America/Lima, and the number still looks like a time.
 *
 * The API resolved "today" against the same zone, so a time formatted here agrees
 * with the day the grid is drawing and with the "today" the API used.
 *
 * Named for what it is rather than dropped into a shared `utils` directory (rule 12):
 * the only inputs are an instant and a zone, and there is one correct answer for
 * each.
 */

/** Rendered in place of a time we cannot read, rather than as `Invalid Date`. */
const UNREADABLE = '—';

/**
 * What a time reads as while the clinic's zone is still being fetched.
 *
 * Said once because it is said in four places — three on the patient profile and
 * one in the visit workspace — and four copies of a sentence drift. It names what is
 * being waited for rather than showing nothing: a blank where a time belongs reads as
 * "there is no appointment", which is a different fact, and a fallback to the
 * browser's zone puts the wrong hour there instead.
 */
export const READING_THE_CLINIC_CLOCK = 'Reading the clinic’s clock…';

/**
 * The wall-clock time, e.g. `14:00`.
 *
 * 24-hour on purpose: a clinic book is read aloud ("four in the afternoon") and
 * `4:00 PM` next to `16:00` in the same column is how a receptionist books the wrong
 * hour. `hour12: false` is explicit for the same reason — it is not the locale's
 * default, and the default differs per machine.
 */
export function formatClinicTime(instant: string, timeZone: string, locale?: string): string {
  return format(instant, timeZone, locale, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The day and the time, e.g. `Mon 5 Oct, 14:00`. */
export function formatClinicDayTime(instant: string, timeZone: string, locale?: string): string {
  return format(instant, timeZone, locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The day, e.g. `5 Oct 2026`, with no time on it.
 *
 * For the moments a clinic records rather than schedules: when a patient was added,
 * when an invoice was written. They are instants too, so they are drawn in the clinic's
 * zone like everything else — a record created at 22:30 UTC on the 5th belongs to the
 * 5th in Lima and to the 6th in Auckland, and the day the receptionist remembers is the
 * clinic's.
 */
export function formatClinicDay(instant: string, timeZone: string, locale?: string): string {
  return format(instant, timeZone, locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A booked span, e.g. `14:00 – 15:00`.
 *
 * Both ends are drawn in the clinic's zone. When the appointment runs past midnight
 * the two ends are on different days, and a bare `22:00 – 01:00` reads as if it were
 * backwards, so the second end is spelled out with its day.
 */
export function formatClinicTimeRange(
  startsAt: string,
  endsAt: string,
  timeZone: string,
  locale?: string,
): string {
  const start = formatClinicTime(startsAt, timeZone, locale);
  const end = formatClinicTime(endsAt, timeZone, locale);
  if (start === UNREADABLE || end === UNREADABLE) {
    return UNREADABLE;
  }
  if (!isSameDay(startsAt, endsAt, timeZone)) {
    return `${start} – ${formatClinicDayTime(endsAt, timeZone, locale)}`;
  }
  return `${start} – ${end}`;
}

/**
 * Formats an instant, or says it could not be read.
 *
 * The zone comes from the clinic's own record, so it is data rather than a constant —
 * and a record can be wrong. An unknown zone makes `Intl` throw, which inside a
 * render takes the screen down with it; a booking whose time cannot be drawn should
 * cost one time, not the panel. UTC is the wrong answer to give silently, so the
 * text says so instead.
 */
function format(
  instant: string,
  timeZone: string,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return UNREADABLE;
  }

  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return UNREADABLE;
  }
}

/**
 * Whether two instants fall on the same day in the clinic's zone.
 *
 * Compared as calendar days in that zone rather than as timestamps 24 hours apart:
 * a 22:00 booking that ends at 01:00 the next morning is one appointment, and the two
 * are a day apart in UTC as well as in the clinic.
 */
function isSameDay(a: string, b: string, timeZone: string): boolean {
  try {
    const day = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    });
    return day.format(new Date(a)) === day.format(new Date(b));
  } catch {
    return true;
  }
}
