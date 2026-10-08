/**
 * The payments recorded against a visit's bill.
 *
 * Mounted only from the payments section, which is mounted only while that section
 * is open — so "fetch what you draw" holds the same way it does for the charges and
 * the notes: the workspace opens on the summary, and a request whose answer no pixel
 * can show is a request that exists to be forgotten when it changes.
 *
 * The shape is the endpoint's own `{ payments: [...] }`, newest received first. Each
 * payment is a full row — method, amount, optional reference, the moment the money
 * arrived — and that is all this register ever answers: "still owed" is a reading of
 * the *charges* list (the bill), and "what remains" is the difference between the
 * two, drawn in the payments section and nowhere else.
 */

import { useQuery } from '@tanstack/react-query';
import type { Payment } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitPaymentsResponse {
  readonly payments: readonly Payment[];
}

export function useVisitPayments(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'payments', visitId],
    queryFn: () => client.get<VisitPaymentsResponse>(`/visits/${visitId}/payments`),
    enabled: visitId.length > 0,
  });
}
