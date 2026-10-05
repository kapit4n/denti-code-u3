/**
 * Agenda entries → FullCalendar events.
 *
 * **This file and `agenda-calendar.tsx` are the only places in the application
 * that may know FullCalendar exists** (ADR 0011). Everything else — the queries,
 * the routes, the domain — deals in `AgendaEntry` and ISO instants. That boundary
 * is the reason FullCalendar could be swapped for a bespoke grid without touching
 * anything but this file and the component.
 *
 * Three things happen here, and all three are translation rather than policy:
 *
 *  - **`startsAt`/`endsAt` are passed through as ISO instants.** The API returns UTC
 *    with an explicit offset, and FullCalendar is given the clinic's IANA zone, so
 *    the library does the timezone arithmetic in the zone the clinic works in.
 *    Nothing here converts a time — converting twice is how a 09:00 booking becomes
 *    02:00 on a screen.
 *  - **Status becomes a class name.** Colour is presentation, not domain: the API
 *    sends a status and the calendar decides what that looks like. The mapping is
 *    one table so a new status cannot be half-styled.
 *  - **The domain entry travels in `extendedProps`.** Clicking a block needs the
 *    patient, the dentist and the id. Carrying the entry means the click handler
 *    reads domain fields rather than parsing a title back into them.
 */

import type { AgendaEntry, AppointmentStatus } from '@denti-code-u3/domain';
import { isScheduleEditable } from '@denti-code-u3/domain';
import type { EventInput } from '@fullcalendar/core';

/**
 * Status → Tailwind classes.
 *
 * Two deliberate choices:
 *
 *  - **Cancelled and no-show are not hidden.** They are drawn struck through and
 *    muted, because a receptionist needs to see that a slot is deliberately empty
 *    rather than free. The API returns them for exactly this reason.
 *  - **Colours come from the design tokens**, not from raw hex values, so the
 *    agenda follows the theme like the rest of the application.
 */
const STATUS_CLASSES: Readonly<Record<AppointmentStatus, readonly string[]>> = {
  SCHEDULED: ['bg-brand-500/15', 'border-brand-500', 'text-brand-900'],
  CONFIRMED: ['bg-brand-500/25', 'border-brand-600', 'text-brand-900'],
  ARRIVED: ['bg-info-muted', 'border-info', 'text-info-text'],
  IN_TREATMENT: ['bg-accent-500/25', 'border-accent-600', 'text-brand-900'],
  COMPLETED: ['bg-success-muted', 'border-success', 'text-success-text'],
  CANCELLED: ['bg-muted', 'border-muted-foreground/40', 'text-muted-foreground', 'line-through'],
  NO_SHOW: ['bg-danger-muted', 'border-danger', 'text-danger-text'],
};

/** Shared by every event, so a block reads as a block rather than a text row. */
const BASE_CLASSES = ['rounded-md', 'border-l-4', 'px-1.5', 'text-xs'] as const;

/**
 * What the title shows.
 *
 * Patient name first: this is a screen a receptionist reads across the room, and
 * "who is in this chair" is the question they are answering. The dentist follows,
 * and an appointment with no dentist says so rather than leaving a blank.
 */
export function toCalendarEventTitle(entry: AgendaEntry): string {
  const patient = `${entry.patientFirstName} ${entry.patientLastName}`.trim();
  return `${patient} · ${entry.dentistFullName ?? 'Unassigned'}`;
}

export function toCalendarEvent(entry: AgendaEntry): EventInput {
  return {
    id: entry.id,
    title: toCalendarEventTitle(entry),
    start: entry.startsAt,
    // The end comes from the API, already computed from start + duration (ADR
    // 0012). The client never re-adds the minutes: two additions of the same
    // duration is how an event ends up one hour from where the database has it.
    end: entry.endsAt,
    classNames: [...BASE_CLASSES, ...STATUS_CLASSES[entry.status]],
    // Whether this block may be dragged or stretched, asked of the domain's own
    // predicate rather than decided here. An appointment whose patient has arrived
    // is history: the API refuses to reschedule it, so a grid that offered the drag
    // would be promising a write that is guaranteed to fail. Per-event rather than
    // per-calendar because the answer differs block by block — one day's
    // cancellations must not disable the morning.
    eventStartEditable: isScheduleEditable(entry.status),
    eventDurationEditable: isScheduleEditable(entry.status),
    extendedProps: { entry },
  };
}

export function toCalendarEvents(entries: readonly AgendaEntry[]): EventInput[] {
  return entries.map(toCalendarEvent);
}

/**
 * The appointment behind a clicked block.
 *
 * Reading it back through one function keeps the `extendedProps` shape private to
 * this file. Returns `undefined` rather than a cast when the payload is not what
 * this adapter put there, so a caller cannot end up holding `undefined` under a
 * type that promised an `AgendaEntry`.
 */
export function agendaEntryFromEvent(event: {
  readonly extendedProps?: Record<string, unknown>;
}): AgendaEntry | undefined {
  const entry = event.extendedProps?.entry;
  return isAgendaEntry(entry) ? entry : undefined;
}

function isAgendaEntry(candidate: unknown): candidate is AgendaEntry {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const entry = candidate as Partial<AgendaEntry>;
  return typeof entry.id === 'string' && typeof entry.startsAt === 'string';
}
