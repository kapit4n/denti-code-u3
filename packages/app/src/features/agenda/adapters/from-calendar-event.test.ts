/**
 * Tests for reading a drop or a resize back as a domain intent.
 *
 * Plain objects, no calendar and no DOM: the adapter declares the four fields it
 * reads, so asserting what a drag means does not require FullCalendar to have
 * rendered anything. What is being pinned down here is the part that is invisible on
 * screen until it is expensive — a request that was never sent, a duration that was
 * restated when it had not changed, and an instant shifted by a second timezone
 * conversion.
 */

import { describe, expect, it } from 'vitest';

import {
  toRescheduleIntent,
  type CalendarEventChange,
  type CalendarEventTimes,
} from './from-calendar-event.js';

const ENTRY = {
  id: 'appt-1',
  patientId: 'pat-1',
  patientFirstName: 'Ana',
  patientLastName: 'Torres',
  dentistId: 'den-1',
  dentistFullName: 'Dra. Rivera',
  startsAt: '2026-10-05T14:00:00.000Z',
  endsAt: '2026-10-05T15:00:00.000Z',
  status: 'CONFIRMED',
} as const;

/** A block as the grid would describe it: 14:00Z for an hour. */
function block(overrides: Partial<CalendarEventTimes> = {}): CalendarEventTimes {
  return {
    id: 'appt-1',
    start: new Date('2026-10-05T14:00:00.000Z'),
    end: new Date('2026-10-05T15:00:00.000Z'),
    extendedProps: { entry: ENTRY },
    ...overrides,
  };
}

function change(overrides: Partial<CalendarEventChange> = {}): CalendarEventChange {
  const current = block();
  return { event: current, oldEvent: current, ...overrides };
}

describe('toRescheduleIntent', () => {
  it('asks for the new start time, in UTC, as the instant actually dropped', () => {
    // 10:00 in America/Lima is 15:00Z. The grid was told the clinic's zone, so the
    // Date it hands over is that instant; the request must carry the same instant
    // rather than a second conversion of it.
    const intent = toRescheduleIntent(
      change({
        event: block({
          start: new Date('2026-10-05T15:00:00.000Z'),
          end: new Date('2026-10-05T16:00:00.000Z'),
        }),
      }),
    );

    expect(intent).toEqual({
      appointmentId: 'appt-1',
      startsAt: '2026-10-05T15:00:00.000Z',
    });
  });

  it('leaves the duration out of a move, because a drag does not change it', () => {
    const intent = toRescheduleIntent(
      change({
        event: block({
          start: new Date('2026-10-05T16:30:00.000Z'),
          end: new Date('2026-10-05T17:30:00.000Z'),
        }),
      }),
    );

    // The block is still an hour. Restating that would tell the API something the
    // user did not decide, and the only way it could go wrong is by going wrong.
    expect(intent).toEqual({
      appointmentId: 'appt-1',
      startsAt: '2026-10-05T16:30:00.000Z',
    });
  });

  it('sends the new length when a resize changed it', () => {
    const intent = toRescheduleIntent(
      change({
        event: block({ end: new Date('2026-10-05T14:45:00.000Z') }),
      }),
    );

    expect(intent).toEqual({
      appointmentId: 'appt-1',
      startsAt: '2026-10-05T14:00:00.000Z',
      durationMinutes: 45,
    });
  });

  it('sends both when a block is dragged to a different day and made longer', () => {
    const intent = toRescheduleIntent(
      change({
        event: block({
          start: new Date('2026-10-06T18:00:00.000Z'),
          end: new Date('2026-10-06T19:30:00.000Z'),
        }),
      }),
    );

    expect(intent).toEqual({
      appointmentId: 'appt-1',
      startsAt: '2026-10-06T18:00:00.000Z',
      durationMinutes: 90,
    });
  });

  it('rounds a length the grid reports in seconds', () => {
    const intent = toRescheduleIntent(
      change({
        event: block({ end: new Date('2026-10-05T14:30:30.000Z') }),
      }),
    );

    // 30 and a half minutes. Refusing it would leave the block on screen at a length
    // the database does not have; the API is what decides whether 30 is bookable.
    expect(intent?.durationMinutes).toBe(31);
  });

  it('asks for nothing when the block was dropped back where it was', () => {
    expect(toRescheduleIntent(change())).toBeUndefined();
  });

  it('asks for nothing when the length was rounded back to what it was', () => {
    // A drag that FullCalendar snapped to the same slot: start and end both moved by
    // 30 seconds, so the block is not where it was — but its length is not new
    // information, and a reschedule that only restates it is a write for a gesture
    // that changed no booking.
    const intent = toRescheduleIntent(
      change({
        event: block({
          start: new Date('2026-10-05T14:00:30.000Z'),
          end: new Date('2026-10-05T15:00:30.000Z'),
        }),
      }),
    );

    expect(intent).toEqual({
      appointmentId: 'appt-1',
      startsAt: '2026-10-05T14:00:30.000Z',
    });
  });

  it('asks for nothing for a block this app did not draw', () => {
    expect(
      toRescheduleIntent(change({ event: block({ extendedProps: { somethingElse: true } }) })),
    ).toBeUndefined();
  });

  it('asks for nothing when the grid reported no start instant', () => {
    // An all-day block with no date, or a malformed event. The API would be handed
    // "Invalid Date" and answer with a validation error nobody can act on.
    expect(toRescheduleIntent(change({ event: block({ start: null }) }))).toBeUndefined();
    expect(
      toRescheduleIntent(change({ event: block({ start: new Date('nonsense') }) })),
    ).toBeUndefined();
  });

  it('does not claim a length for a block the grid says has no end', () => {
    const intent = toRescheduleIntent(
      change({
        event: block({ start: new Date('2026-10-05T15:00:00.000Z'), end: null }),
      }),
    );

    // The start moved, so the reschedule is real. The length is not knowable from
    // what the grid gave us, and absent means "leave it" rather than a guess.
    expect(intent).toEqual({
      appointmentId: 'appt-1',
      startsAt: '2026-10-05T15:00:00.000Z',
    });
  });

  it('uses the entry the block carries, not the id the grid assigned', () => {
    // `id` and the entry's id are the same value today. Reading `id` would be one
    // fewer hop, and would also be a place where a grid that renames its event ids
    // (across a reload, say) would quietly start rescheduling the wrong row.
    const intent = toRescheduleIntent(
      change({
        event: block({
          id: 'fc-internal-7',
          start: new Date('2026-10-05T15:00:00.000Z'),
          end: new Date('2026-10-05T16:00:00.000Z'),
        }),
      }),
    );

    expect(intent?.appointmentId).toBe('appt-1');
  });
});
