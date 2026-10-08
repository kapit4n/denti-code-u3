/**
 * The charges raised on one visit.
 *
 * Mounted only from the charges section, which is mounted only while that section
 * is open — so "fetch what you draw" holds the same way it does for the
 * prescriptions and the notes: the workspace opens on the summary, and a request
 * whose answer no pixel can show is a request that exists to be forgotten when it
 * changes.
 *
 * The shape is the endpoint's own `{ charges: [...] }`. A charge has no address
 * other than its visit (ADR 0023), so there is no second hook beside this one.
 */

import { useQuery } from '@tanstack/react-query';
import type { Charge } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitChargesResponse {
  readonly charges: readonly Charge[];
}

export function useVisitCharges(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'charges', visitId],
    queryFn: () => client.get<VisitChargesResponse>(`/visits/${visitId}/charges`),
    enabled: visitId.length > 0,
  });
}
