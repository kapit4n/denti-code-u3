/**
 * The clinic's own settings.
 *
 * The agenda cannot be drawn without two things that only the clinic knows: the
 * IANA timezone its day starts in, and the hours it is open. Both come from the
 * clinic's own record rather than a build-time constant, because a `VITE_` variable
 * cannot be right for two clinics served by one API — the mistake the API's own
 * `CLINIC_TIME_ZONE` fallback already documents.
 *
 * The shape is the domain's `Clinic`. It is re-exported from `@denti-code-u3/domain`
 * rather than re-declared: a hand-copied response interface is a second source of
 * truth that nothing checks, and this app already had one drift silently.
 */

import { useQuery } from '@tanstack/react-query';
import type { Clinic } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export type { Clinic } from '@denti-code-u3/domain';

export function useClinicSettings() {
  const client = useApiClient();
  return useQuery({
    // One clinic per deployment until authentication exists, so this is fetched once
    // and never invalidated: it is configuration, not data that changes while the
    // user works.
    queryKey: ['clinic', 'settings'],
    queryFn: () => client.get<Clinic>('/clinic'),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
