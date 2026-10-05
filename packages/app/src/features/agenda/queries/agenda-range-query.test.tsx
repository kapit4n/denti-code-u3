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
import type { DentistId } from '@denti-code-u3/types';
import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
} from '@denti-code-u3/types';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import {
  agendaRangeKey,
  hasAgendaFilters,
  useAgendaRange,
  NO_AGENDA_FILTERS,
  type AgendaFilters,
  type AgendaRange,
} from './agenda-range-query.js';

const BASE_URL = 'http://api.test/api/v1';

const RANGE: AgendaRange = {
  from: '2026-10-05T00:00:00.000Z',
  to: '2026-10-06T00:00:00.000Z',
};

const DENTIST_ONE = asDentistId('den-1');
const DENTIST_TWO = asDentistId('den-2');
const CHAIR_ONE = asChairId('chair-1');

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
function renderAgendaRange(
  range: AgendaRange | undefined,
  reply: () => Promise<Response>,
  filters?: AgendaFilters,
) {
  const results: Probe[] = [];

  const fetchImplementation = vi.fn<typeof fetch>(reply);
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Probe(): ReactNode {
    const query = useAgendaRange(range, filters);
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
 * The URL of a request the client made.
 *
 * Throws when it made none: "the grid never asked for anything" is a failure these
 * tests exist to catch, and a thrown message says so.
 */
function firstRequestedUrl(fetchImplementation: ReturnType<typeof vi.fn>, index = 0): string {
  const call = fetchImplementation.mock.calls[index];

  if (!call) {
    throw new Error(`Expected a request number ${index + 1}, but the client made none`);
  }

  return String(call[0]);
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

  it('differs for a different narrowing of the same window', () => {
    // The grid and the filter bar's state are one question. Two keys for one
    // selection would mean a cache that holds a stale unfiltered copy beside the
    // filtered one, and no rule saying which one a later reader gets.
    expect(agendaRangeKey(RANGE, { dentistIds: [DENTIST_ONE], chairIds: [] })).not.toEqual(
      agendaRangeKey(RANGE, NO_AGENDA_FILTERS),
    );
  });

  it('is the same key however the ids were clicked', () => {
    // A filter is a set. Clicking two chips in either order asks for one day with two
    // names on it, and without the sort the second order would be fetched again —
    // the grid repainting after a round trip that changed nothing.
    expect(
      agendaRangeKey(RANGE, { dentistIds: [DENTIST_ONE, DENTIST_TWO], chairIds: [CHAIR_ONE] }),
    ).toEqual(
      agendaRangeKey(RANGE, { dentistIds: [DENTIST_TWO, DENTIST_ONE], chairIds: [CHAIR_ONE] }),
    );
  });

  it('treats an explicit empty selection as no narrowing at all', () => {
    // The grid always passes its filters and the sidebar passes nothing, so a marker
    // for "explicitly empty" would put the same day in the cache twice and make the
    // second one a fresh request. Both spellings must land on one key.
    expect(agendaRangeKey(RANGE, NO_AGENDA_FILTERS)).toEqual(agendaRangeKey(RANGE));

    // Worth stating, because the alternative *looks* observable and is not: the
    // `'dentists'` and `'chairs'` labels in the key would stop a dentist id reading
    // as a chair id, which needs the same uuid in both lists — impossible for two
    // tables that generate their own. So nothing asserts them. The labels are there
    // because the key is read by a human in a cache inspector.
  });
});

describe('hasAgendaFilters', () => {
  it('is false for no narrowing and true for either kind', () => {
    expect(hasAgendaFilters(NO_AGENDA_FILTERS)).toBe(false);
    expect(hasAgendaFilters({ dentistIds: [], chairIds: [CHAIR_ONE] })).toBe(true);
    expect(hasAgendaFilters({ dentistIds: [DENTIST_ONE], chairIds: [] })).toBe(true);
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

  describe('with a narrowing', () => {
    it('sends exactly the clinicians that are selected, not the ones that were ever clicked', async () => {
      const { fetchImplementation } = renderAgendaRange(
        RANGE,
        () => Promise.resolve(jsonResponse({ items: [], window: RANGE })),
        { dentistIds: [DENTIST_ONE, DENTIST_TWO], chairIds: [CHAIR_ONE] },
      );

      await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));

      // The load-bearing assertion of the whole feature. Fetching the day and
      // filtering the answer in the browser would render an identical grid today and
      // be wrong the first time the API learned a rule the client had not heard of —
      // and nothing in a component test could catch that, because the two look the
      // same on screen.
      const url = firstRequestedUrl(fetchImplementation);
      expect(url).toContain(`dentistIds=${DENTIST_ONE}%2C${DENTIST_TWO}`);
      expect(url).toContain(`chairIds=${CHAIR_ONE}`);
      // And the window is still sent: a narrowed day is still a day.
      expect(url).toContain(`from=${encodeURIComponent(RANGE.from)}`);
    });

    it('drops a deselected clinician from the request rather than keeping it', async () => {
      // The chip removes an id from the selection, and the selection is what travels.
      // An implementation that accumulated ids — `push` into state, a `Set` that never
      // had anything removed from it — would send a clinician the user can no longer
      // see on the bar, and the grid would keep drawing their day while the chips say
      // otherwise. This is the failure a state-shape bug produces and only the wire
      // can catch.
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const fetchImplementation = vi.fn<typeof fetch>(() =>
        Promise.resolve(jsonResponse({ items: [], window: RANGE })),
      );
      const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });

      function Probe({ dentistIds }: { readonly dentistIds: readonly DentistId[] }): ReactNode {
        useAgendaRange(RANGE, { dentistIds, chairIds: [] });
        return null;
      }

      const tree = (dentistIds: readonly DentistId[]): ReactNode => (
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider baseUrl={BASE_URL} client={client}>
            <Probe dentistIds={dentistIds} />
          </ApiClientProvider>
        </QueryClientProvider>
      );

      const { rerender } = render(tree([DENTIST_ONE, DENTIST_TWO]));
      await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));

      rerender(tree([DENTIST_TWO]));

      await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
      const narrowed = firstRequestedUrl(fetchImplementation, 1);
      expect(narrowed).toContain(`dentistIds=${DENTIST_TWO}`);
      expect(narrowed).not.toContain(DENTIST_ONE);
    });

    it('asks for the day and no clinician at all when nothing is selected', async () => {
      // A contract assertion rather than a guard assertion, and the distinction is
      // worth stating: `toQuery`'s `length` check and `buildQueryString`'s dropping of
      // empty values both prevent `?dentistIds=` from being sent, so deleting either
      // one alone would not fail here. What this protects is the *pair* — the request
      // the API receives is the same whichever of the two stops doing its job, which
      // is exactly why neither can be removed on the evidence of this test.
      const { fetchImplementation } = renderAgendaRange(
        RANGE,
        () => Promise.resolve(jsonResponse({ items: [entry()], window: RANGE })),
        { dentistIds: [], chairIds: [] },
      );

      await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));

      const url = firstRequestedUrl(fetchImplementation);
      expect(url).not.toContain('dentistIds');
      expect(url).not.toContain('chairIds');
      expect(url).toContain(`from=${encodeURIComponent(RANGE.from)}`);
    });

    it('re-reads the day when the narrowing changes, rather than keeping the old answer', async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const fetchImplementation = vi.fn<typeof fetch>(() =>
        Promise.resolve(jsonResponse({ items: [entry()], window: RANGE })),
      );
      const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
      const seen: (readonly AgendaEntry[] | undefined)[] = [];

      function Probe({ filters }: { readonly filters: AgendaFilters }): ReactNode {
        const query = useAgendaRange(RANGE, filters);
        seen.push(query.data?.items);
        return null;
      }

      const tree = (filters: AgendaFilters): ReactNode => (
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider baseUrl={BASE_URL} client={client}>
            <Probe filters={filters} />
          </ApiClientProvider>
        </QueryClientProvider>
      );

      const { rerender } = render(tree({ dentistIds: [], chairIds: [] }));

      await waitFor(() => expect(seen.at(-1)).toHaveLength(1));

      rerender(tree({ dentistIds: [DENTIST_ONE], chairIds: [] }));

      // The blocks on screen answer the previous question. Keeping them would show
      // every clinician's day after one of them was deselected — the exact drift the
      // unfiltered case already guards against for navigation.
      await waitFor(() => expect(seen.at(-1)).toBeUndefined());
    });
  });
});
