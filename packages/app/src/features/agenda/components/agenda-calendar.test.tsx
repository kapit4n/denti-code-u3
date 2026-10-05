/**
 * Tests for the agenda calendar.
 *
 * FullCalendar is replaced with a stub that records the props it was handed. The
 * library does its own rendering, and asserting on its internal DOM in jsdom would
 * test the library rather than this code. What matters here is the wiring *we* own:
 * which timezone the grid is told to draw in, which window is fetched for what is on
 * screen, and what the user is told when the range is empty or the request failed.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Clinic } from '@denti-code-u3/domain';
import type { CalendarOptions, DatesSetArg } from '@fullcalendar/core';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { AgendaCalendar } from './agenda-calendar.js';

/** Every `CalendarOptions` the component has rendered, newest last. */
const rendered: CalendarOptions[] = [];

vi.mock('@fullcalendar/react', () => ({
  default: (options: CalendarOptions) => {
    rendered.push(options);
    return <div data-testid="calendar" />;
  },
}));

const BASE_URL = 'http://api.test/api/v1';

const CLINIC: Clinic = {
  id: 'clinic-1',
  name: 'Clínica Dental U3',
  legalName: 'Denti-Code U3 S.A.C.',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [
    { weekday: 1, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
    { weekday: 2, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
  ],
  settings: {},
};

const AGENDA_ITEM = {
  id: 'appt-1',
  patientId: 'pat-1',
  patientFirstName: 'Ana',
  patientLastName: 'Torres',
  dentistId: 'den-1',
  dentistFullName: 'Dra. Rivera',
  chairId: 'chair-1',
  chairName: 'Sillón 1',
  durationMinutes: 60,
  startsAt: '2026-10-05T14:00:00.000Z',
  endsAt: '2026-10-05T15:00:00.000Z',
  status: 'CONFIRMED',
};

/**
 * What the filter bar asks for, answered before any test's own `reply` is consulted.
 *
 * Without this the bar was handed the appointment fixture: a chip would render with
 * `undefined` for a name, and every test in this file would be passing on a screen
 * that could never be built. `reply` owns the range and the writes, which is what
 * these tests are about; the bar has a spec of its own.
 */
const RESOURCE_FIXTURES: readonly (readonly [string, readonly unknown[]])[] = [
  [
    '/dentists',
    [{ id: 'den-1', fullName: 'Dra. Rivera', speciality: null, color: '#0ea5e9', isActive: true }],
  ],
  [
    '/chairs',
    [
      {
        id: 'chair-1',
        roomId: 'room-1',
        roomName: 'Consultorio 1',
        name: 'Sillón 1',
        isActive: true,
      },
    ],
  ],
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `reply` sees the request, so a test can answer a write differently from the read it
 * triggers. A single canned answer cannot: the write is followed by a refetch of the
 * range, which is the point of the invalidation and not an accident.
 */
function renderCalendar({
  reply = () => Promise.resolve(jsonResponse({ items: [AGENDA_ITEM] })),
}: {
  readonly reply?: (init: RequestInit | undefined) => Promise<Response>;
} = {}) {
  rendered.length = 0;
  const fetchImplementation = vi.fn<typeof fetch>((url, init) => {
    const resource = RESOURCE_FIXTURES.find(([path]) => String(url).includes(path));
    return resource ? Promise.resolve(jsonResponse({ items: resource[1] })) : reply(init);
  });
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <AgendaCalendar clinic={CLINIC} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

/**
 * The reads of the visible range — and nothing else.
 *
 * The grid mounts a filter bar, so it asks for the clinicians and the chairs as well,
 * and those two requests are not the range. Counting every fetch made "the grid asked
 * for one window" mean "the grid and its filter bar asked for three things", which is
 * how six assertions in this file came to be about the harness rather than about the
 * behaviour. Each of them says "the range", so each of them now reads the range.
 */
function rangeCalls(fetchImplementation: ReturnType<typeof vi.fn>) {
  return fetchImplementation.mock.calls.filter(([url]) => String(url).includes('/appointments?'));
}

/** The writes. Every request carries a method, so a read is a `GET`. */
function writes(fetchImplementation: ReturnType<typeof vi.fn>) {
  return fetchImplementation.mock.calls.filter(([, init]) => init?.method !== 'GET');
}

/** The options from the most recent render. */
function latest(): CalendarOptions {
  const options = rendered.at(-1);
  if (!options) throw new Error('the calendar never rendered');
  return options;
}

/** Drives the grid the way FullCalendar does on mount and on every navigation. */
function tellGrid(range: { start: string; end: string }) {
  const datesSet = latest().datesSet as (arg: DatesSetArg) => void;
  datesSet({
    start: new Date(range.start),
    end: new Date(range.end),
    view: latest(),
  } as unknown as DatesSetArg);
}

/** A block as the grid would hand it to a gesture handler: Dates, plus the entry. */
function gridEvent(startIso: string, endIso: string) {
  return {
    id: 'appt-1',
    start: new Date(startIso),
    end: new Date(endIso),
    extendedProps: { entry: AGENDA_ITEM },
  };
}

/** A drop, driven the way FullCalendar drives it after a drag. */
function dropBlock({
  from = ['2026-10-05T14:00:00.000Z', '2026-10-05T15:00:00.000Z'],
  to = ['2026-10-05T16:00:00.000Z', '2026-10-05T17:00:00.000Z'],
  revert = vi.fn(),
}: {
  readonly from?: [string, string];
  readonly to?: [string, string];
  readonly revert?: () => void;
} = {}) {
  const eventDrop = latest().eventDrop as (arg: unknown) => void;
  eventDrop({ event: gridEvent(...to), oldEvent: gridEvent(...from), revert });
}

/**
 * The JSON body of a request.
 *
 * Takes the call tuple rather than a fetch mock and an index, so a caller cannot
 * index a mock and pass a different request than the one it just counted.
 */
function bodyOf(call: readonly unknown[] | undefined): unknown {
  if (!call) {
    throw new Error('Expected a request, but the client made none');
  }
  return JSON.parse(String((call[1] as RequestInit | undefined)?.body));
}

describe('AgendaCalendar', () => {
  it('draws in the clinic timezone, not the browser one', () => {
    renderCalendar();

    // The API resolved "today" against this zone too. A grid drawn in the browser's
    // zone would show a Lima clinic's morning in the afternoon for anyone travelling,
    // and the bookings would still look plausible.
    expect(latest().timeZone).toBe('America/Lima');
  });

  it('shades the clinic opening hours and starts the day at the first opening', () => {
    renderCalendar();

    expect(latest().businessHours).toEqual([
      { daysOfWeek: [1], startTime: '08:00', endTime: '13:00' },
      { daysOfWeek: [2], startTime: '08:00', endTime: '13:00' },
    ]);
    expect(latest().scrollTime).toBe('08:00');
  });

  it('fetches the window the grid says it is showing', async () => {
    const { fetchImplementation } = renderCalendar();

    // Only the range. The filter bar's two lists are its own business, and this
    // assertion is about the grid's window.
    expect(rangeCalls(fetchImplementation)).toHaveLength(0);

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });

    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));
    const [call] = rangeCalls(fetchImplementation);
    if (!call) throw new Error('Expected the calendar to request the visible range');
    const url = String(call[0]);
    // The grid knows which days it is showing, including a week view's leading days.
    // A second opinion about that window is how a grid ends up drawing events that
    // were never fetched.
    expect(url).toContain('from=2026-10-05T00%3A00%3A00.000Z');
    expect(url).toContain('to=2026-10-06T00%3A00%3A00.000Z');
  });

  it('fetches again for each navigation', async () => {
    const { fetchImplementation } = renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));

    tellGrid({ start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z' });

    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(2));
  });

  it('puts the fetched appointments on the grid', async () => {
    renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });

    await waitFor(() => expect(latest().events).toHaveLength(1));
    const [event] = latest().events as { id: string; title: string }[];
    expect(event?.id).toBe('appt-1');
    expect(event?.title).toBe('Ana Torres · Dra. Rivera');
  });

  it('says so when the range holds no appointments', async () => {
    renderCalendar({
      reply: () =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });

    // An empty grid with no explanation reads as a rendering fault.
    expect(await screen.findByText('No appointments in this range.')).toBeTruthy();
  });

  it('reports a failed load instead of an empty day', async () => {
    renderCalendar({
      reply: () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'boom' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });

    // An empty grid and a failed request look identical on screen; a receptionist
    // who reads the first as the second books a patient into a busy chair.
    expect(await screen.findByRole('alert')).toHaveTextContent('The agenda could not be loaded.');
  });

  it('makes the grid writable, but only where the domain says so', async () => {
    renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(latest().events).toHaveLength(1));

    // The switch is on for the grid as a whole, and the per-event flags decide block
    // by block. A calendar-level refusal would disable Monday's morning because of a
    // cancellation on Tuesday.
    expect(latest().editable).toBe(true);
    const [event] = latest().events as { eventStartEditable?: boolean }[];
    expect(event?.eventStartEditable).toBe(true);
  });

  it('refuses to make an arrived appointment draggable', async () => {
    renderCalendar({
      reply: () =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [{ ...AGENDA_ITEM, status: 'ARRIVED' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(latest().events).toHaveLength(1));

    // The API refuses to reschedule it, so offering the drag would be a gesture
    // guaranteed to fail.
    const [event] = latest().events as { eventStartEditable?: boolean }[];
    expect(event?.eventStartEditable).toBe(false);
  });

  it('sends a drag as a reschedule, then re-reads the day', async () => {
    const { fetchImplementation } = renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));

    const revert = vi.fn();
    dropBlock({ revert });

    // Three requests to the range and one write, told apart by what they are rather
    // than by when they happened: the write and the read it triggers are now
    // interleaved with two resource reads of the filter bar's, so an index into
    // `mock.calls` would be asserting the harness's timing.
    await waitFor(() => {
      expect(writes(fetchImplementation)).toHaveLength(1);
      expect(rangeCalls(fetchImplementation)).toHaveLength(2);
    });

    const [writeUrl, writeInit] = writes(fetchImplementation)[0] ?? [];
    expect(String(writeUrl)).toBe(`${BASE_URL}/appointments/appt-1/schedule`);
    expect(writeInit?.method).toBe('PUT');
    // The block was dropped an hour later: 16:00Z, which is 11:00 in Lima. Only the
    // start travels — a drag does not restate the length, so the chair cannot be
    // cleared on the way past.
    expect(bodyOf(writes(fetchImplementation)[0])).toEqual({
      startsAt: '2026-10-05T16:00:00.000Z',
    });

    // The second read of the range is it being read again: the grid is redrawn from
    // the server's answer rather than from the gesture. That refetch is the whole
    // point of not writing the move into the cache.
    const [refetchUrl, refetchInit] = rangeCalls(fetchImplementation)[1] ?? [];
    expect(refetchInit?.method).toBe('GET');
    expect(String(refetchUrl)).toContain('/appointments?from=');

    // Not reverted: the server agreed. Reverting here would make the block jump back
    // and then forward while the refetch was in flight.
    expect(revert).not.toHaveBeenCalled();
  });

  it('sends the new length when a block is stretched', async () => {
    const { fetchImplementation } = renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));

    // Same start, an end 30 minutes later: the length is the thing that changed.
    dropBlock({ to: ['2026-10-05T14:00:00.000Z', '2026-10-05T14:30:00.000Z'] });

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    const [url] = writes(fetchImplementation)[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/appointments/appt-1/schedule`);
    expect(bodyOf(writes(fetchImplementation)[0])).toEqual({
      startsAt: '2026-10-05T14:00:00.000Z',
      durationMinutes: 30,
    });
  });

  it('asks for nothing when a block is dropped back where it was', async () => {
    const { fetchImplementation } = renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));

    dropBlock({ to: ['2026-10-05T14:00:00.000Z', '2026-10-05T15:00:00.000Z'] });

    // A gesture that changed nothing is not a write. It can fail — an appointment
    // checked in a moment ago can no longer be rescheduled — and the receptionist
    // would be told off for a drag that did nothing.
    //
    // Asserted as "no write", not as "the call count did not move": the count is the
    // harness's, and the filter bar has already moved it twice before the drag.
    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(0));
    expect(rangeCalls(fetchImplementation)).toHaveLength(1);
  });

  it('puts the block back and says which hour is taken when the move is refused', async () => {
    const { fetchImplementation } = renderCalendar({
      // The range is answered normally; only the write is refused.
      reply: (init) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? new Response(
                JSON.stringify({
                  error: {
                    code: 'SCHEDULING_CONFLICT',
                    message: 'The appointment overlaps 1 existing appointment(s)',
                    details: {
                      conflicts: [
                        {
                          appointmentId: '99999999-9999-4999-8999-999999999999',
                          patientId: '88888888-8888-4888-8888-888888888888',
                          dentistId: '77777777-7777-4777-8777-777777777777',
                          startsAt: '2026-10-05T17:00:00.000Z',
                          endsAt: '2026-10-05T18:00:00.000Z',
                        },
                      ],
                    },
                    requestId: 'req-1',
                  },
                }),
                { status: 409, headers: { 'content-type': 'application/json' } },
              )
            : new Response(JSON.stringify({ items: [AGENDA_ITEM] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
        ),
    });

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));

    const revert = vi.fn();
    dropBlock({ revert });

    // 18:00Z is 13:00 in Lima — the hour the receptionist has to go and look at, in
    // the clinic's clock rather than the server's.
    expect(await screen.findByTestId('schedule-write-failure')).toHaveTextContent('12:00 – 13:00');
    // The block must go back where it was, or the grid is showing a booking the
    // database never accepted.
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it('opens the quick panel on a click, and closes it again', async () => {
    const user = userEvent.setup();
    renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(latest().events).toHaveLength(1));

    expect(screen.queryByTestId('appointment-quick-panel')).toBeNull();

    const eventClick = latest().eventClick as (arg: unknown) => void;
    eventClick({ event: gridEvent('2026-10-05T14:00:00.000Z', '2026-10-05T15:00:00.000Z') });

    // The entry travels with the block, so the panel knows the patient without the
    // title being parsed back into one.
    expect(await screen.findByTestId('appointment-quick-panel')).toHaveTextContent('Ana Torres');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('appointment-quick-panel')).toBeNull());
  });

  it('opens nothing for a block this app did not draw', async () => {
    renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(latest().events).toHaveLength(1));

    const eventClick = latest().eventClick as (arg: unknown) => void;
    eventClick({ event: { id: 'x', start: new Date(), end: null, extendedProps: {} } });

    // A panel about `undefined` is worse than no panel.
    expect(screen.queryByTestId('appointment-quick-panel')).toBeNull();
  });

  it('opens the booking dialog for the slot the user clicked', async () => {
    renderCalendar();

    // `selectable` and `dateClick` together: the first makes empty slots clickable at
    // all, the second reports which one. A grid with only the first would swallow the
    // gesture. This test replaces one that asserted the opposite on purpose — the two
    // read endpoints the form needs now exist.
    expect(latest().selectable).toBeTruthy();

    const dateClick = latest().dateClick as (arg: unknown) => void;
    await act(async () => {
      dateClick({ date: new Date('2026-10-05T14:00:00.000Z') });
    });

    expect(await screen.findByTestId('appointment-booking-dialog')).toBeInTheDocument();
  });

  it('closes the booking dialog without writing anything when it is dismissed', async () => {
    const { fetchImplementation } = renderCalendar();

    const dateClick = latest().dateClick as (arg: unknown) => void;
    await act(async () => {
      dateClick({ date: new Date('2026-10-05T14:00:00.000Z') });
    });
    await screen.findByTestId('appointment-booking-dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('appointment-booking-dialog')).toBeNull());
    // Stopping looking at a slot is not a cancellation: no booking was made, so no
    // write may have happened. This is the assertion that makes it a dismissal rather
    // than a silent write — stated as "no write", so the filter bar's reads cannot
    // either satisfy it or break it.
    expect(writes(fetchImplementation)).toHaveLength(0);
  });

  it('narrows the request when a chip is clicked, rather than hiding blocks on the grid', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(1));

    // The unfiltered request names no clinician at all: `?dentistIds=` would be a
    // filter that matched nothing, not "every clinician".
    expect(String(rangeCalls(fetchImplementation)[0]?.[0])).not.toContain('dentistIds');

    const chip = await screen.findByRole('button', { name: 'Dra. Rivera' });
    await user.click(chip);

    // The claim is about the *request*, and this is the assertion for it: the grid
    // asks the API which appointments belong to that clinician's day rather than
    // drawing the whole day and dropping the blocks. A client-side filter would leave
    // the URL untouched and this would never see a second read.
    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(2));
    expect(String(rangeCalls(fetchImplementation)[1]?.[0])).toContain(`dentistIds=den-1`);

    // And clearing the chip goes back to the unfiltered answer rather than to nothing.
    await user.click(chip);

    await waitFor(() => expect(rangeCalls(fetchImplementation)).toHaveLength(3));
    const cleared = String(rangeCalls(fetchImplementation)[2]?.[0]);
    expect(cleared).not.toContain('dentistIds');
    expect(cleared).toContain('from=2026-10-05');
  });

  it('says an empty filtered range differently from an empty day', async () => {
    const user = userEvent.setup();
    renderCalendar({
      reply: () => Promise.resolve(jsonResponse({ items: [] })),
    });

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });

    expect(await screen.findByText('No appointments in this range.')).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: 'Dra. Rivera' }));

    // "Nothing booked" and "nothing for *her*" are different facts, and the second
    // reading as the first sends someone looking for a cancellation that never
    // happened.
    expect(
      await screen.findByText('No appointments match these filters in this range.'),
    ).toBeTruthy();
  });

  it('does not pre-judge the slot: a click at 03:00 still opens the dialog', async () => {
    renderCalendar();

    const dateClick = latest().dateClick as (arg: unknown) => void;
    await act(async () => {
      dateClick({ date: new Date('2026-10-05T03:00:00.000Z') });
    });

    // The domain owns opening hours and says what they are. A click that silently did
    // nothing would answer a different question and explain nothing.
    expect(await screen.findByTestId('appointment-booking-dialog')).toBeInTheDocument();
  });
});
