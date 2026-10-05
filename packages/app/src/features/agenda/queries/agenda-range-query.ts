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
import type { ChairId, DentistId } from '@denti-code-u3/types';

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

/**
 * Which clinicians and chairs the grid is showing.
 *
 * A narrowing of the same window, not a different window: `GET /api/v1/appointments`
 * has accepted `dentistIds` and `chairIds` since session 13 and the domain's
 * `AgendaWindow` carries them, so this query sends what the user asked for rather
 * than fetching everything and hiding blocks in the browser. The distinction is
 * visible, not stylistic: a filtered answer is the API's, so it can be wrong in
 * exactly the ways the unfiltered answer can, and there is no second implementation
 * of "which appointments match" living in a component.
 */
export interface AgendaFilters {
  readonly dentistIds: readonly DentistId[];
  readonly chairIds: readonly ChairId[];
}

/** No narrowing. Also the state the filter bar starts in. */
export const NO_AGENDA_FILTERS: AgendaFilters = { dentistIds: [], chairIds: [] };

export function hasAgendaFilters(filters: AgendaFilters): boolean {
  return filters.dentistIds.length > 0 || filters.chairIds.length > 0;
}

/**
 * Stable key: two components asking for the same window and the same filters share
 * one request.
 *
 * **Sorted, and that is load-bearing.** Ids reach the key in the order the user
 * clicked them, and clicking the same two chips in the opposite order asks for the
 * same day with the same two names. Without the sort the cache would hold two
 * copies of one answer — and, worse, the second copy would be fetched rather than
 * reused, so the grid would repaint after a round trip that changed nothing.
 */
export function agendaRangeKey(range: AgendaRange, filters?: AgendaFilters) {
  return [
    'agenda',
    'range',
    range.from,
    range.to,
    'dentists',
    ...(filters?.dentistIds ?? []).slice().sort(),
    'chairs',
    ...(filters?.chairIds ?? []).slice().sort(),
  ] as const;
}

/**
 * The ids as the API reads them.
 *
 * Comma-separated, because `agendaRangeQuerySchema` splits one parameter on commas
 * rather than accepting a repeated key: one query string either way, and a single
 * comma is not a shape two places have to agree on.
 *
 * An empty selection is omitted rather than sent as an empty string, and the reason
 * is worth getting right — **the API would in fact cope either way, and the first
 * version of this comment claimed the opposite.** Checked against a running API:
 * `?dentistIds=` returns the whole day, because `uuidListSchema` drops the blank and
 * the repository skips a filter of length zero. So this branch changes no response.
 *
 * It stays for two reasons, neither of them "otherwise the grid breaks today". A
 * cleared filter *should* read as an absent one, and the two are the same request
 * here only because two separate guards on the server happen to agree — a client that
 * encodes its intent at the point it builds the value does not have to know that.
 * And `filters?.dentistIds.join(',')` reads as a request for no dentist at all, which
 * is exactly the bug a reader would try to fix by *adding* this branch back somewhere
 * else. Two `length` checks cost nothing; a comment that lied about the server would
 * have cost more.
 */
function toQuery(filters?: AgendaFilters) {
  return {
    dentistIds: filters?.dentistIds.length ? filters.dentistIds.join(',') : undefined,
    chairIds: filters?.chairIds.length ? filters.chairIds.join(',') : undefined,
  };
}

export function useAgendaRange(range: AgendaRange | undefined, filters?: AgendaFilters) {
  const client = useApiClient();
  const narrowing = toQuery(filters);

  return useQuery({
    queryKey: agendaRangeKey(range ?? { from: '', to: '' }, filters),
    queryFn: () =>
      client.get<AgendaRangeResponse>('/appointments', {
        query: { from: range?.from, to: range?.to, ...narrowing },
      }),
    // Without a range there is nothing to ask for, and a request with empty bounds
    // would be rejected with a validation error the user cannot act on.
    enabled: range !== undefined,
    // No `placeholderData` on purpose. Navigating to tomorrow gives a new cache key,
    // and keeping the previous window's events would draw yesterday's appointments
    // on tomorrow's grid for as long as the request took — the exact drift the
    // window exists to prevent. An empty grid with a "loading" hint is honest.
    //
    // A filter change gets the same treatment for the same reason: the blocks on
    // screen belong to the answer for the *previous* selection, and keeping them
    // would show a dentist's appointments after that dentist was deselected.
  });
}
