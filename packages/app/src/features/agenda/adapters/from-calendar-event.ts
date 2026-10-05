/**
 * A dragged or resized block → a domain intent.
 *
 * The write-side counterpart to `to-calendar-event.ts`, and the same bargain in
 * reverse: this is the only place that knows what a FullCalendar object is made of,
 * so nothing downstream of it has to (ADR 0011).
 *
 * **No FullCalendar import, on purpose.** This file declares the four fields it
 * actually reads and nothing more, and `EventApi` satisfies that shape
 * structurally. The alternative — typing the parameter as `EventDropArg` — would
 * couple this file to the library for no gain in safety: if the library ever
 * renamed `start`, the call site in the calendar component would stop compiling
 * either way, because `arg.event` would no longer fit the shape declared here. So
 * the guard in `scripts/check-boundaries.mjs` does not need this file on its
 * allowlist, the adapter can be tested with plain objects, and nothing here loads
 * a calendar library to prove that a drag means what it means.
 *
 * Three decisions that are the reason this is a file rather than three lines in the
 * component:
 *
 *  - **A gesture that changed nothing produces no intent.** Dropping a block back
 *    where it already was is not a write. It would send a request that can fail —
 *    an appointment that has since been checked in cannot be rescheduled — and the
 *    receptionist would be told off for a drag that did nothing.
 *  - **A move does not resend the duration.** FullCalendar keeps an event's length
 *    when it is dragged, so the duration is unchanged; sending it anyway would
 *    restate a fact the API already has, and restating it is how a 30-minute
 *    appointment quietly becomes 29 after a round trip through a rounding step.
 *    A resize, which genuinely changed the length, is the only case that sends one.
 *  - **The instants are passed through, never converted.** The grid was told the
 *    clinic's zone, `toISOString()` hands back the same instant in UTC, and that is
 *    what the API stores. Converting a second time is how a 09:00 booking becomes
 *    02:00 on a screen (see the note in `to-calendar-event.ts`).
 *
 * What the adapter deliberately does **not** do is judge whether the move is
 * allowed — no overlap check, no opening-hours check, no "is that slot free". Those
 * are the domain's and the API's rules, and a client that pre-judged them would
 * answer differently from the server and then disagree with it in front of the
 * user. The grid already refuses to offer a drag for an appointment whose schedule
 * is no longer editable (`isScheduleEditable`, in `to-calendar-event.ts`) and the
 * API refuses everything else; a third silent check here would only produce a drag
 * that appears to do nothing.
 */

import type { AppointmentId, IsoDateTime } from '@denti-code-u3/types';

import { agendaEntryFromEvent } from './to-calendar-event.js';

/**
 * The four fields read off a FullCalendar event.
 *
 * Structural rather than imported, as the header explains. `end` is null for an
 * event the grid was told has no end; the adapter treats that as "the length is not
 * known" rather than inventing one.
 */
export interface CalendarEventTimes {
  readonly id: string;
  readonly start: Date | null;
  readonly end: Date | null;
  readonly extendedProps?: Record<string, unknown>;
}

/** What a drag or a resize is asking for, in the API's own words. */
export interface AppointmentRescheduleIntent {
  readonly appointmentId: AppointmentId;
  /** Required by the endpoint: a reschedule always states where the block lands. */
  readonly startsAt: IsoDateTime;
  /** Only when the length actually changed. Absent means "leave it as it is". */
  readonly durationMinutes?: number;
}

/** What the grid hands over after a drop or a resize. */
export interface CalendarEventChange {
  readonly event: CalendarEventTimes;
  readonly oldEvent: CalendarEventTimes;
}

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Reads a drop or a resize as a reschedule intent.
 *
 * Returns `undefined` — meaning "there is nothing to ask the API" — in three cases,
 * all of them deliberate: the block is not one of ours, the grid reported no start
 * instant, or the gesture left the block exactly where it was.
 */
export function toRescheduleIntent(
  change: CalendarEventChange,
): AppointmentRescheduleIntent | undefined {
  const entry = agendaEntryFromEvent(change.event);
  if (!entry) {
    return undefined;
  }

  const start = change.event.start;
  if (!start || Number.isNaN(start.getTime())) {
    return undefined;
  }

  const previousStart = change.oldEvent.start?.getTime();
  const previousEnd = change.oldEvent.end?.getTime();
  const nextEnd = change.event.end?.getTime();

  const movedStart = previousStart === undefined || start.getTime() !== previousStart;
  const movedEnd = nextEnd === undefined || nextEnd !== previousEnd;
  if (!movedStart && !movedEnd) {
    return undefined;
  }

  // `end` is only consulted to notice that the *length* changed. A drag keeps the
  // length, so the two are equal and the duration stays out of the request.
  const durationMinutes = durationIfChanged(previousStart, previousEnd, start, nextEnd);

  return {
    appointmentId: entry.id,
    startsAt: start.toISOString() as IsoDateTime,
    ...(durationMinutes === undefined ? {} : { durationMinutes }),
  };
}

/**
 * The new length in whole minutes, or `undefined` when it did not change.
 *
 * Rounded, and the honest reason is that this should not happen: both ends are slot
 * boundaries drawn in the clinic's zone, so their difference is a whole number of
 * minutes. It is rounded rather than asserted because a whole-number guarantee held
 * by a calendar's layout rules is not a guarantee worth turning into a failed drag —
 * the cost of rounding when the difference is already whole is zero, and the cost of
 * being wrong about that is a request the API rejects over a half minute. Whether
 * the rounded number is a *bookable* duration is the API's call: it owns the
 * 5..480 range, and answering that here would be a second, drifting copy.
 */
function durationIfChanged(
  previousStartMs: number | undefined,
  previousEndMs: number | undefined,
  start: Date,
  nextEndMs: number | undefined,
): number | undefined {
  if (nextEndMs === undefined) {
    // The grid says the event has no end, so its length is not something this
    // adapter can state. Sending the old duration would be a guess.
    return undefined;
  }

  if (previousStartMs === undefined || previousEndMs === undefined) {
    return undefined;
  }

  const previousMinutes = Math.round((previousEndMs - previousStartMs) / MILLISECONDS_PER_MINUTE);
  const nextMinutes = Math.round((nextEndMs - start.getTime()) / MILLISECONDS_PER_MINUTE);
  return nextMinutes === previousMinutes ? undefined : nextMinutes;
}
