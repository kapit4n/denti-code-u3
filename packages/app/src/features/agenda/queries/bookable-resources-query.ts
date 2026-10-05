/**
 * The two lists a booking is made against, and the two lists the agenda filters.
 *
 * One file for both, because they are one question asked twice — "who and what can
 * this appointment name?" — and the answer differs only in which endpoint is called
 * and in who is asking.
 *
 * **The two callers want different lists, and that is the point of `onlyActive`.**
 *
 * - The booking dialog asks for active rows only, so a clinician who has left is
 *   not offered in a dropdown whose selection would be refused. That is a
 *   convenience, not the rule: the rule lives in the domain and is enforced by the
 *   API (ADR 0020). The consequence is deliberate — a clinician deactivated while
 *   the dialog is open still produces a refusal, from the server, naming them,
 *   which is why the dialog shows the message rather than silently dropping the
 *   selection.
 * - The agenda's filter asks for **every** row, active or not. A filter that hid
 *   the departed would make it impossible to look at the day they worked, and the
 *   agenda would show their appointments naming nobody. This is the same reason the
 *   two list endpoints default `onlyActive` to no filter, and it is why the two
 *   callers cannot share one cached answer.
 *
 * The response shapes are the domain's `DentistSummary` and `ChairSummary`,
 * imported rather than copied: a hand-copied response interface is a second source
 * of truth that nothing checks, and this app has had one drift silently.
 */

import { useQuery } from '@tanstack/react-query';
import type { ChairSummary, DentistSummary } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

interface ListResponse<T> {
  readonly items: readonly T[];
}

/**
 * Which rows to ask for.
 *
 * Required rather than defaulted, because the default would be wrong for one of the
 * two callers and a caller that forgot to say which would silently get the other
 * one's list.
 */
export interface ResourceListOptions {
  readonly onlyActive: boolean;
}

export function useDentists({ onlyActive }: ResourceListOptions) {
  const client = useApiClient();

  return useQuery({
    // `onlyActive` is part of the key rather than left out: the two lists are
    // different answers to different questions, and one cached copy under one key
    // would be whichever was fetched last.
    queryKey: ['dentists', 'list', { onlyActive }],
    queryFn: () =>
      client.get<ListResponse<DentistSummary>>('/dentists', {
        query: { onlyActive: String(onlyActive) },
      }),
    // The clinic's clinicians do not change while the user works, and a filter bar
    // that refetches on every render would make the chips flicker for no reason.
    // The API still has the final word at write time.
    staleTime: 60_000,
  });
}

export function useChairs({ onlyActive }: ResourceListOptions) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['chairs', 'list', { onlyActive }],
    queryFn: () =>
      client.get<ListResponse<ChairSummary>>('/chairs', {
        query: { onlyActive: String(onlyActive) },
      }),
    staleTime: 60_000,
  });
}
