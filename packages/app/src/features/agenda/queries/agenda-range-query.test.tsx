/**
 * Tests for the agenda's range query.
 *
 * The behaviour worth protecting is which window is asked for, and what happens to
 * the previous window's events when the user navigates. Both are easy to get subtly
 * wrong and hard to see: a query that asks for the wrong days still renders a
 * plausible grid, and a query that keeps yesterday's data renders yesterday's
 * appointments under today's date.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import type { AgendaEntry } from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
} from '@denti-code-u3/types';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { agendaRangeKey, useAgendaRange, type AgendaRange } from './agenda-range-query.js';

const BASE_URL = 'http://api.test/api/v1';

const RANGE: AgendaRange = {
  from: '2026-10-05T00:00:00.000Z',
  to: '2026-10-06T00:00:00.000Z',
};

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

interface Probe {
  readonly data: readonly AgendaEntry[] | undefined;
  readonly error: boolean;
}

/**
 * Renders the hook and reports what it resolved to.
 *
 * A probe component rather than `renderHook` because the hook needs both providers,
 * and rendering the probe the way a feature would keeps the test honest about what a
 * feature actually gets.
 */
function renderAgendaRange(range: AgendaRange | undefined, reply: () => Promise<Response>) {
  const results: Probe[] = [];

  const fetchImplementation = vi.fn<typeof fetch>(reply);
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Probe(): ReactNode {
    const query = useAgendaRange(range);
    results.push({ data: query.data?.items, error: query.isError });
    return null;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <Probe />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, results };
}

/**
 * The URL of the first request the client made.
 *
 * Throws when it made none: "the grid never asked for anything" is a failure these
 * tests exist to catch, and a thrown message says so.
 */
function firstRequestedUrl(fetchImplementation: ReturnType<typeof vi.fn>): string {
  const [first] = fetchImplementation.mock.calls;

  if (!first) {
    throw new Error('Expected a request, but the client made none');
  }

  return String(first[0]);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('agendaRangeKey', () => {
  it('is the same key for the same window', () => {
    // Two components asking for the same days — the grid and a side panel — must
    // share one request rather than doubling the load on the clinic's API.
    expect(agendaRangeKey(RANGE)).toEqual(agendaRangeKey({ ...RANGE }));
  });

  it('differs for a different window', () => {
    expect(agendaRangeKey(RANGE)).not.toEqual(
      agendaRangeKey({ ...RANGE, from: '2026-10-06T00:00:00.000Z' }),
    );
  });
});

describe('useAgendaRange', () => {
  it('asks for nothing until it is given a window', async () => {
    const { fetchImplementation, results } = renderAgendaRange(undefined, () =>
      Promise.resolve(jsonResponse({ items: [entry()], window: RANGE })),
    );

    // Before the first `datesSet` there is no window. A request with empty bounds
    // would come back as a validation error the user cannot act on.
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(results.at(-1)?.data).toBeUndefined();
  });

  it('asks for exactly the window it was given', async () => {
    const { fetchImplementation, results } = renderAgendaRange(RANGE, () =>
      Promise.resolve(jsonResponse({ items: [entry()], window: RANGE })),
    );

    await waitFor(() => expect(results.at(-1)?.data).toHaveLength(1));

    // Half-open bounds, as ISO instants: the API treats `to` as exclusive, so
    // sending a local midnight or an inclusive end would shift every appointment
    // that lands on the boundary.
    expect(firstRequestedUrl(fetchImplementation)).toBe(
      `${BASE_URL}/appointments?from=${encodeURIComponent(RANGE.from)}&to=${encodeURIComponent(RANGE.to)}`,
    );
  });

  it('returns the entries it was given', async () => {
    const { results } = renderAgendaRange(RANGE, () =>
      Promise.resolve(
        jsonResponse({ items: [entry(), entry({ id: asAppointmentId('appt-2') })], window: RANGE }),
      ),
    );

    await waitFor(() => expect(results.at(-1)?.data).toHaveLength(2));
  });

  it('drops the previous window instead of showing it under the new dates', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let calls = 0;
    const fetchImplementation = vi.fn<typeof fetch>(() => {
      calls += 1;
      // The first window answers; every later one hangs, which is what a slow
      // network looks like from the grid's side.
      if (calls === 1) {
        return Promise.resolve(jsonResponse({ items: [entry()], window: RANGE }));
      }
      return new Promise<Response>(() => undefined);
    });
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
    const seen: (readonly AgendaEntry[] | undefined)[] = [];

    function Probe({ range }: { readonly range: AgendaRange | undefined }): ReactNode {
      const query = useAgendaRange(range);
      seen.push(query.data?.items);
      return null;
    }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider baseUrl={BASE_URL} client={client}>
          <Probe range={RANGE} />
        </ApiClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(seen.at(-1)).toHaveLength(1));

    rerender(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider baseUrl={BASE_URL} client={client}>
          <Probe range={{ from: '2026-10-06T00:00:00.000Z', to: '2026-10-07T00:00:00.000Z' }} />
        </ApiClientProvider>
      </QueryClientProvider>,
    );

    // Keeping the previous window's events would draw Monday's appointments on
    // Tuesday's grid. An empty grid with a loading hint is the honest answer.
    await waitFor(() => expect(seen.at(-1)).toBeUndefined());
  });

  it('reports a failure instead of an empty day', async () => {
    const { results } = renderAgendaRange(RANGE, () =>
      Promise.resolve(jsonResponse({ code: 'VALIDATION_ERROR', message: 'from is required' }, 400)),
    );

    // A silently empty grid and a rejected query look identical on screen, and the
    // first one is the dangerous reading: a receptionist would conclude the day is
    // free.
    await waitFor(() => expect(results.at(-1)?.error).toBe(true));
  });
});
