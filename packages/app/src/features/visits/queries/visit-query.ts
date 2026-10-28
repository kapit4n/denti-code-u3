/**
 * Reading one visit.
 *
 * The response shape is the domain's `Visit`, imported rather than copied: a
 * hand-copied response interface is a second source of truth that nothing checks,
 * and this app has already had one drift silently (`usePatientOdontogram`, which
 * expected `items` where the API has always returned `entries`).
 *
 * The list beside it is `useVisitList`. ADR 0023 said there would be no `GET
 * /visits`; ADR 0031 adds one, scoped to the caller, because the sidebar has always
 * linked to `/visits` and a directory is a different question from one patient's
 * timeline.
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
