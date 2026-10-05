/**
 * The agenda's range query.
 *
 * The window comes from the calendar component, not from this hook: the component
 * already knows which dates it is drawing, because FullCalendar hands them to
 * `datesSet` on every navigation. This hook therefore fetches "exactly what is on
 * screen" and never guesses a range of its own — a query that computes its own
 * window is a second answer to "which days are we showing", and it is the one that
 * quietly stops matching the grid.
 *
 * The response shape is the domain's `AgendaEntry`, re-declared from
 * `@denti-code-u3/domain` rather than hand-copied. The previous hand-copied
 * response interface in this app had already drifted once without anything
 * noticing, because nothing checked a copy against its original.
 */

import { useQuery } from '@tanstack/react-query';
import type { AgendaEntry } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

/** One half-open window `[from, to)`, as ISO instants. */
export interface AgendaRange {
  readonly from: string;
  readonly to: string;
}

export interface AgendaRangeResponse {
  readonly items: readonly AgendaEntry[];
  readonly window: AgendaRange;
}

/** Stable key: two components asking for the same window share one request. */
export function agendaRangeKey(range: AgendaRange) {
  return ['agenda', 'range', range.from, range.to] as const;
}

export function useAgendaRange(range: AgendaRange | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: agendaRangeKey(range ?? { from: '', to: '' }),
    queryFn: () =>
      client.get<AgendaRangeResponse>('/appointments', {
        query: { from: range?.from, to: range?.to },
      }),
    // Without a range there is nothing to ask for, and a request with empty bounds
    // would be rejected with a validation error the user cannot act on.
    enabled: range !== undefined,
    // No `placeholderData` on purpose. Navigating to tomorrow gives a new cache key,
    // and keeping the previous window's events would draw yesterday's appointments
    // on tomorrow's grid for as long as the request took — the exact drift the
    // window exists to prevent. An empty grid with a "loading" hint is honest.
  });
}
