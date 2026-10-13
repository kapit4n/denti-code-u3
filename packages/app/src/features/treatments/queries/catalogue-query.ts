/**
 * The clinic's treatment catalogue: the procedures this clinic offers.
 *
 * **The catalogue belongs to this feature, not to the visit that names it.** It
 * moved here when the `/treatments` page arrived, because a page that administers
 * the catalogue while reaching into `features/visits` for it reads backwards: the
 * visits feature is one *reader* of this collection (its picker resolves a record's
 * name), and a reader does not own the thing it reads. One collection, one key,
 * one hook — so the picker and the catalogue page share a cache and cannot show
 * two different offers of the same clinic.
 *
 * Scoped to the clinic by the API header, so the key needs no clinic id: two
 * clinics cannot be on screen at once, and the provider's base URL already
 * answers for the one that is.
 *
 * The same staleness the bookable lists take: the catalogue does not change while
 * somebody works, and a picker that refetched on every open would flicker for no
 * reason. The API still has the final word at write time — which is the whole
 * argument for the 60 seconds rather than for infinity.
 */

import { useQuery } from '@tanstack/react-query';
import type { TreatmentCatalogueItem } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

interface CatalogueResponse {
  readonly items: readonly TreatmentCatalogueItem[];
}

export function useTreatments() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['treatments'],
    queryFn: () => client.get<CatalogueResponse>('/treatments'),
    staleTime: 60_000,
  });
}
