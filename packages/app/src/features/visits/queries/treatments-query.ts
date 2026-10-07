/**
 * The two reads the treatments section draws: what this clinic offers, and what
 * was recorded on one visit.
 *
 * They are separate hooks with separate keys because they are separate questions
 * with separate lives: the catalogue changes when the clinic edits its offer (a
 * rare, admin event worth a minute of staleness, the same tolerance the bookable
 * lists have), and one visit's records change every time this screen writes one.
 * A record joins its treatment by id against the catalogue in the section, not in
 * the query — the names are presentation, and the two read hooks stay about their
 * own collections.
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
import type { TreatmentCatalogueItem, TreatmentRecord } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

interface CollectResponse<T> {
  readonly items: readonly T[];
}

export interface VisitTreatmentsResponse {
  readonly treatments: readonly TreatmentRecord[];
}

/**
 * The catalogue of procedures this clinic offers, for the picker in the form.
 *
 * Scoped to the clinic by the API header, so the key needs no clinic id: two
 * clinics cannot be on screen at once, and the provider's base URL already
 * answers for the one that is.
 */
export function useTreatments() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['treatments'],
    queryFn: () => client.get<CollectResponse<TreatmentCatalogueItem>>('/treatments'),
    // The catalogue does not change while the user works, and a picker that
    // refetches on every open would flicker for no reason. The API still has the
    // final word at write time.
    staleTime: 60_000,
  });
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
