/**
 * The prescriptions written on one visit.
 *
 * The shape is the endpoint's own `{ prescriptions: [...] }` rather than a bare
 * array, for the same reason the notes and the records answer wrapped: a list
 * that arrives bare is a list whose envelope a future field has to break to add.
 *
 * **This hook is only ever called from the prescriptions section, which is mounted
 * only while that section is open** — so "fetch what you draw" holds without an
 * `enabled` flag held back at the call site, exactly the argument the notes hook
 * makes: the workspace opens on the summary, and a request whose answer no pixel on
 * screen can show is a request that exists to be forgotten when it changes.
 *
 * There is no second hook beside it: a prescription has no address other than its
 * visit (ADR 0023).
 */

import { useQuery } from '@tanstack/react-query';
import type { Prescription } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitPrescriptionsResponse {
  readonly prescriptions: readonly Prescription[];
}

export function useVisitPrescriptions(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'prescriptions', visitId],
    queryFn: () => client.get<VisitPrescriptionsResponse>(`/visits/${visitId}/prescriptions`),
    enabled: visitId.length > 0,
  });
}
