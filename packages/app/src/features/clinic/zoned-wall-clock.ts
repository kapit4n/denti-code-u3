/**
 * Wall clock ⇄ instant, in the clinic's own zone.
 *
 * The inverse of `format-clinic-time.ts`, and kept beside it for one reason: those two
 * must agree, and a reader who has to look in two directories to check that has to
 * assume they might not.
 *
 * **A booking dialog reached from the profile or the dashboard has no grid in front of
 * it**, so nothing else on that screen can answer "when". The person types a wall clock
 * — `2026-10-06T09:00` — and that is a claim about the *clinic's* clock, not the
 * machine's. Converting it needs the zone, and the zone comes from the clinic record
 * rather than from `Intl.DateTimeFormat().resolvedOptions()`, which answers with
 * whichever side of the planet the receptionist's laptop is on.
 *
 * **Luxon rather than `Intl`, deliberately.** Doing this with `Intl` means reading the
 * zone's offset at some moment, guessing whether the offset changes across the
 * boundary, and hoping; `DateTime.fromISO(value, { zone })` asks the zone database the
 * question directly. Luxon is already a direct dependency of this package for
 * FullCalendar's timezone plugin, so this is not a new library in the app — it is the
 * same one already doing this work for the grid.
 *
 * **A time that does not exist is refused, not shifted.** Twice a year, in a zone that
 * observes daylight saving, a wall clock like `02:30` never happens: the clocks jump
 * from `02:00` to `03:00`. Luxon resolves that to `03:30` without complaining, which
 * would book a patient for an hour nobody chose and never say so. The instant is
 * therefore round-tripped back to a wall clock and compared, and a value that does not
 * survive the trip did not exist.
 */

import { DateTime } from 'luxon';

/** The shape an `<input type="datetime-local">` reports: `YYYY-MM-DDTHH:mm`. */
const WALL_CLOCK_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The clinic's wall clock for an instant, ready for a `datetime-local` input.
 *
 * The same pattern the browser reports, so a value that came from here can go straight
 * back through `zonedWallClockToInstant` without the user typing anything.
 *
 * `undefined` for something that is not an instant, rather than Luxon's `Invalid
 * DateTime` — that string is not a time, and a caller that puts it in a form has
 * already lost the ability to tell the person anything true.
 */
export function instantToZonedWallClock(instant: string, timeZone: string): string | undefined {
  const zoned = DateTime.fromISO(instant, { zone: timeZone });
  if (!zoned.isValid) {
    return undefined;
  }

  return zoned.toFormat("yyyy-MM-dd'T'HH:mm");
}

/**
 * The instant a clinic wall clock names, or `undefined` when that clock never showed
 * it.
 *
 * `undefined` rather than a fallback instant, because there is no honest fallback: the
 * caller can say "that time does not exist here" and be right, or invent an hour and be
 * wrong silently. The gap is the only way this returns `undefined` — a malformed value
 * is the schema's business, not this function's.
 *
 * **Ambiguous times pick the first occurrence.** In a zone that repeats an hour when
 * the clocks go back, `01:30` happens twice and this returns the earlier one. Choosing
 * the later would book an appointment an hour after the receptionist's stated intent,
 * which is the worse of the two mistakes; the clinic can move it, and the API is the
 * one that finally gets to object.
 */
export function zonedWallClockToInstant(wallClock: string, timeZone: string): string | undefined {
  if (!WALL_CLOCK_PATTERN.test(wallClock)) {
    return undefined;
  }

  const zoned = DateTime.fromISO(wallClock, { zone: timeZone });
  if (!zoned.isValid) {
    return undefined;
  }

  // The round trip: a wall clock the zone could not honour comes back as a different
  // hour, and that difference is the whole test.
  if (zoned.toFormat("yyyy-MM-dd'T'HH:mm") !== wallClock) {
    return undefined;
  }

  return zoned.toUTC().toISO();
}
