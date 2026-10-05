/**
 * Clinic opening hours → FullCalendar business hours.
 *
 * Second adapter file, same rule as `to-calendar-event.ts`: FullCalendar's types
 * appear here and in the calendar component, nowhere else (ADR 0011).
 *
 * The translation that matters is the weekday. The domain speaks ISO-8601
 * (`1 = Monday … 7 = Sunday`) because that is what clinicians and standards use;
 * FullCalendar speaks `0 = Sunday … 6 = Saturday` because it is built on JavaScript's
 * `Date.getDay()`. Copying the number across makes every clinic open a day late and
 * close a day early, which is the kind of bug nobody reports — the grid just looks
 * plausible.
 *
 * A day with **no row at all** is deliberately left out rather than drawn as open or
 * closed. Missing is not the same as either, and a calendar that guessed would be
 * asserting a schedule the clinic never set. For the same reason a row whose weekday
 * or times cannot be understood is dropped instead of being emitted without a
 * `daysOfWeek`: FullCalendar reads that as "every day", which is the loudest possible
 * answer to a question the record did not answer.
 */

import type { Clinic } from '@denti-code-u3/domain';
import type { EventInput } from '@fullcalendar/core';

/** ISO weekday (1 = Monday … 7 = Sunday) → JavaScript day (0 = Sunday … 6). */
const ISO_WEEKDAY_TO_JS_DAY: Readonly<Record<number, number>> = {
  7: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
};

/** `HH:MM`, the shape FullCalendar parses for a wall-clock time. */
const LOCAL_TIME = /^[0-9]{2}:[0-9]{2}$/;

export function toBusinessHours(clinic: Clinic): EventInput[] {
  return clinic.operatingHours
    .filter((hours) => !hours.isClosed && ISO_WEEKDAY_TO_JS_DAY[hours.weekday] !== undefined)
    .map((hours) => {
      const day = ISO_WEEKDAY_TO_JS_DAY[hours.weekday];

      return {
        daysOfWeek: [day as number],
        startTime: hours.opensAtLocalTime,
        endTime: hours.closesAtLocalTime,
      };
    })
    .filter((event) => LOCAL_TIME.test(event.startTime) && LOCAL_TIME.test(event.endTime));
}

/**
 * The earliest opening time in the week, as `HH:MM`.
 *
 * Used for the grid's initial scroll position: a clinic that opens at 14:00 should
 * not have to scroll past seven empty hours to see its first patient. `undefined`
 * when the clinic has no usable hours, which leaves FullCalendar's default alone.
 */
export function toScrollTime(clinic: Clinic): string | undefined {
  const openings = clinic.operatingHours
    .filter((hours) => !hours.isClosed && LOCAL_TIME.test(hours.opensAtLocalTime))
    .map((hours) => hours.opensAtLocalTime)
    .sort();

  return openings[0];
}
