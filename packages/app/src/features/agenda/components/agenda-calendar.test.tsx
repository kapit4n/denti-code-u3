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
import { render, screen, waitFor } from '@testing-library/react';
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
  startsAt: '2026-10-05T14:00:00.000Z',
  endsAt: '2026-10-05T15:00:00.000Z',
  status: 'CONFIRMED',
};

function renderCalendar({
  reply = () =>
    Promise.resolve(
      new Response(JSON.stringify({ items: [AGENDA_ITEM] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
}: {
  readonly reply?: () => Promise<Response>;
} = {}) {
  rendered.length = 0;
  const fetchImplementation = vi.fn<typeof fetch>(reply);
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

    expect(fetchImplementation).not.toHaveBeenCalled();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
    const [call] = fetchImplementation.mock.calls;
    if (!call) throw new Error('Expected the calendar to request the visible range');
    const url = String(call[0]);
    // The grid knows which days it is showing, including a week view's leading days.
    // A second opinion about that window is how a grid ends up drawing events that
    // were never fetched.
    expect(String(url)).toContain('from=2026-10-05T00%3A00%3A00.000Z');
    expect(String(url)).toContain('to=2026-10-06T00%3A00%3A00.000Z');
  });

  it('fetches again for each navigation', async () => {
    const { fetchImplementation } = renderCalendar();

    tellGrid({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' });
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));

    tellGrid({ start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z' });

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
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

  it('offers no way to change an appointment yet', () => {
    renderCalendar();

    // A draggable or clickable-looking block that does nothing is worse than an
    // absent one, because it promises a write side that is not there.
    expect(latest().editable).toBeFalsy();
    expect(latest().selectable).toBeFalsy();
    expect(latest().eventClick).toBeUndefined();
  });
});
