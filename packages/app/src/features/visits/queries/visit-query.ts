/**
 * Reading one visit.
 *
 * The response shape is the domain's `Visit`, imported rather than copied: a
 * hand-copied response interface is a second source of truth that nothing checks,
 * and this app has already had one drift silently (`usePatientOdontogram`, which
 * expected `items` where the API has always returned `entries`).
 *
 * There is deliberately no list hook beside it. `GET /visits` with a window and a
 * set of filters does not exist (ADR 0023): a visit is a clinical record with no
 * schedule, and the only collection anyone has asked for is one patient's own
 * timeline, addressed by the patient.
 */

import { useQuery } from '@tanstack/react-query';
import type { Visit } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useVisit(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'detail', visitId],
    queryFn: () => client.get<Visit>(`/visits/${visitId}`),
    enabled: visitId.length > 0,
  });
}
