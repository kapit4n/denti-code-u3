/**
 * What the treatments recorded on one visit consumed.
 *
 * One read for the whole visit rather than one per treatment: each row carries its
 * `treatmentRecordId`, so the section groups them locally. The treatments section
 * mounts this query only while it is open, the same "fetch what you draw" rule the
 * records query follows.
 */

import { useQuery } from '@tanstack/react-query';
import type { TreatmentSupply } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitTreatmentSuppliesResponse {
  readonly supplies: readonly TreatmentSupply[];
}

export function useVisitTreatmentSupplies(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'treatment-supplies', visitId],
    queryFn: () =>
      client.get<VisitTreatmentSuppliesResponse>(`/visits/${visitId}/treatment-supplies`),
    enabled: visitId.length > 0,
  });
}
