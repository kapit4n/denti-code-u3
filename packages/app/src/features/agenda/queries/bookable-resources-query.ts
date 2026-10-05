/**
 * The two lists a booking is made against.
 *
 * One file for both, because they are one question asked twice — "who can this
 * appointment name?" — and the answer differs only in which endpoint is called.
 *
 * **`onlyActive: true`, and that is a convenience rather than the rule.** The booking
 * rule itself lives in the domain and is enforced by the API (ADR 0020); asking for
 * active rows only keeps a clinician who has left out of a dropdown whose selection
 * would be refused, which is a shorter list rather than a policy. The query says
 * `true` for the same reason a patient list defaults to active: a form offers what
 * can be used.
 *
 * The consequence is deliberate and worth stating: a clinician deactivated while the
 * dialog is open still produces a refusal, from the server, naming them. That is the
 * designed behaviour — the client is not the authority — and it is why the dialog
 * shows the message rather than silently dropping the selection.
 *
 * The response shapes are the domain's `DentistSummary` and `ChairSummary`, imported
 * rather than copied: a hand-copied response interface is a second source of truth
 * that nothing checks, and this app has had one drift silently.
 */

import { useQuery } from '@tanstack/react-query';
import type { ChairSummary, DentistSummary } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

interface ListResponse<T> {
  readonly items: readonly T[];
}

export function useDentists() {
  const client = useApiClient();

  return useQuery({
    // `['dentists']` is a prefix, so the agenda's own filters and this dialog share
    // one answer rather than keeping two copies of the clinic's clinicians.
    queryKey: ['dentists', 'list'],
    queryFn: () =>
      client.get<ListResponse<DentistSummary>>('/dentists', {
        query: { onlyActive: 'true' },
      }),
    // The clinic's clinicians do not change while the user works, and a dialog that
    // refetches on every open would make a list flicker for no reason. The API
    // still has the final word: a deactivated clinician is refused at write time.
    staleTime: 60_000,
  });
}

export function useChairs() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['chairs', 'list'],
    queryFn: () =>
      client.get<ListResponse<ChairSummary>>('/chairs', {
        query: { onlyActive: 'true' },
      }),
    staleTime: 60_000,
  });
}
