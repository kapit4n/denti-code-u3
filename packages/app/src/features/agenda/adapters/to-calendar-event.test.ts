/**
 * Tests for the AgendaEntry → FullCalendar translation.
 *
 * The adapter is where a timezone bug would be cheapest to catch and most expensive
 * to notice later, so the instants are asserted as *passed through*: the adapter's
 * job is not to move time, and a change that starts adjusting them is the bug.
 */

import type { AgendaEntry, AppointmentStatus } from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
} from '@denti-code-u3/types';
import { describe, expect, it } from 'vitest';

import { agendaEntryFromEvent, toCalendarEvent, toCalendarEvents } from './to-calendar-event.js';

function entry(overrides: Partial<AgendaEntry> = {}): AgendaEntry {
  return {
    id: asAppointmentId('appt-1'),
    clinicId: asClinicId('clinic-1'),
    patientId: asPatientId('pat-1'),
    patientFirstName: 'Ana',
    patientLastName: 'Torres',
    dentistId: asDentistId('den-1'),
    dentistFullName: 'Dra. Rivera',
    chairId: asChairId('chair-1'),
    chairName: 'Silla 1',
    durationMinutes: 60,
    startsAt: '2026-10-05T14:00:00.000Z',
    endsAt: '2026-10-05T15:00:00.000Z',
    status: 'SCHEDULED',
    notes: null,
    ...overrides,
  };
}

describe('toCalendarEvent', () => {
  it('passes the instants through untouched', () => {
    const event = toCalendarEvent(entry());

    // The API sends UTC instants and FullCalendar is handed the clinic's IANA zone,
    // so the library does the arithmetic. If either side converted a second time, a
    // 09:00 booking would land on the grid at the wrong hour — and the two errors
    // could cancel out in one timezone while being wrong everywhere else.
    expect(event.start).toBe('2026-10-05T14:00:00.000Z');
    expect(event.end).toBe('2026-10-05T15:00:00.000Z');
  });

  it('carries the identity and the title a receptionist reads', () => {
    const event = toCalendarEvent(entry());

    expect(event.id).toBe('appt-1');
    expect(event.title).toBe('Ana Torres · Dra. Rivera');
  });

  it('names an unassigned dentist rather than leaving a blank', () => {
    // A gap in the book is real information. An empty column reads as a rendering
    // fault, and a receptionist would have to click through to find out.
    expect(toCalendarEvent(entry({ dentistFullName: null })).title).toBe('Ana Torres · Unassigned');
  });

  it('keeps the domain entry in extendedProps', () => {
    const original = entry();

    const event = toCalendarEvent(original);

    // Clicking a block needs the patient and the dentist. Reading them back out of a
    // title string would mean parsing text the user can see.
    expect(agendaEntryFromEvent(event)).toEqual(original);
  });

  it.each([
    'SCHEDULED',
    'CONFIRMED',
    'ARRIVED',
    'IN_TREATMENT',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ] satisfies AppointmentStatus[])('gives %s its own styling', (status) => {
    const event = toCalendarEvent(entry({ status }));

    // A status missing from the table would render as an unstyled block, which is
    // the kind of gap nobody reports until a screen looks wrong in a chair.
    expect(event.classNames?.length).toBeGreaterThan(0);
  });

  it('distinguishes cancelled from no-show, and both from completed', () => {
    const cancelled = toCalendarEvent(entry({ status: 'CANCELLED' })).classNames;
    const noShow = toCalendarEvent(entry({ status: 'NO_SHOW' })).classNames;
    const completed = toCalendarEvent(entry({ status: 'COMPLETED' })).classNames;

    expect(cancelled).not.toEqual(noShow);
    expect(cancelled).not.toEqual(completed);
  });

  it('strikes through a cancelled appointment instead of hiding it', () => {
    // A slot that is deliberately empty must look empty on purpose: hiding it would
    // make the chair look bookable.
    expect(toCalendarEvent(entry({ status: 'CANCELLED' })).classNames).toContain('line-through');
  });

  it('lets a future appointment be dragged and stretched', () => {
    // The grid is editable, so whether *this* block may move is the only question —
    // and the answer is the domain's, not a table kept alongside it.
    for (const status of ['SCHEDULED', 'CONFIRMED'] as const) {
      const event = toCalendarEvent(entry({ status }));

      expect(event.eventStartEditable).toBe(true);
      expect(event.eventDurationEditable).toBe(true);
    }
  });

  it('refuses to offer a drag for an appointment whose time is history', () => {
    // Once the patient has arrived the booked time is history, and the API refuses to
    // reschedule it. Offering the drag would be a gesture guaranteed to fail.
    for (const status of [
      'ARRIVED',
      'IN_TREATMENT',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ] as const) {
      const event = toCalendarEvent(entry({ status }));

      expect(event.eventStartEditable).toBe(false);
      expect(event.eventDurationEditable).toBe(false);
    }
  });
});

describe('toCalendarEvents', () => {
  it('keeps the order the API sent', () => {
    const events = toCalendarEvents([
      entry({ id: asAppointmentId('a') }),
      entry({ id: asAppointmentId('b') }),
      entry({ id: asAppointmentId('c') }),
    ]);

    expect(events.map((event) => event.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for an empty range', () => {
    expect(toCalendarEvents([])).toEqual([]);
  });
});

describe('agendaEntryFromEvent', () => {
  it('returns undefined for a payload this adapter did not write', () => {
    // A cast instead of a check would hand the caller `undefined` under a type that
    // promised an AgendaEntry, and the failure would surface somewhere unrelated.
    expect(agendaEntryFromEvent({})).toBeUndefined();
    expect(agendaEntryFromEvent({ extendedProps: {} })).toBeUndefined();
    expect(agendaEntryFromEvent({ extendedProps: { entry: 'not an entry' } })).toBeUndefined();
  });
});
