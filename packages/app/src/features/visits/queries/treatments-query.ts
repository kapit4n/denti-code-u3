/**
 * What was actually done in one visit.
 *
 * The catalogue this section's picker draws from no longer lives here: it moved
 * to `features/treatments/queries/catalogue-query.ts` when `/treatments` arrived,
 * because a page that administers a collection should own it and the visit is
 * only one reader of it. Both draw the same `['treatments']` key, so the picker
 * and the catalogue page still show one clinic one offer.
 *
 * **The records hook is only ever called from the treatments section, which is
 * mounted only while that section is open** — the same "fetch what you draw"
 * argument as the notes hook: the workspace opens on the summary, and a request
 * whose answer no pixel can show is a request that exists to be forgotten.
 *
 * There is no second records hook beside it: treatments have no address other
 * than their visit (the same reasoning ADR 0023 applies to notes).
 */

import { useQuery } from '@tanstack/react-query';
import type { TreatmentRecord } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitTreatmentsResponse {
  readonly treatments: readonly TreatmentRecord[];
}

/**
 * What was actually done in one visit, oldest first.
 */
export function useVisitTreatments(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'treatments', visitId],
    queryFn: () => client.get<VisitTreatmentsResponse>(`/visits/${visitId}/treatments`),
    enabled: visitId.length > 0,
  });
}
