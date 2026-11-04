/**
 * One patient's complete clinical timeline.
 *
 * The endpoint is uncapped on purpose (ADR 0023): a screen that says "these are
 * this patient's visits" has to be able to trust that it is all of them. The
 * profile uses a separate, bounded read for the visits that still need attention;
 * this hook is the history, asked for only when the history page is open.
 *
 * The response shape is the domain's `Visit`, imported rather than copied so the
 * page and the endpoint cannot drift apart.
 */

import { useQuery } from '@tanstack/react-query';
import type { Visit } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface PatientVisitsResponse {
  readonly visits: readonly Visit[];
}

export function usePatientVisits(patientId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'visits', patientId],
    queryFn: () => client.get<PatientVisitsResponse>(`/patients/${patientId}/visits`),
    enabled: patientId.length > 0,
  });
}
