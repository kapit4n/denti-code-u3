/**
 * Raising a bill for a visit's un-invoiced charges.
 *
 * **Nothing is written optimistically.** Issuing a document does not change the
 * visit row, so the workspace and any screen holding copies of it must be
 * refetched via the charges/payments/invoice surfaces the bill touches. The
 * charges list is the one that says which rows are now invoiced, the payments
 * door may close as a result, and the patient's invoice list gains a document.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InvoiceDetail } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useCreateVisitInvoice() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (visitId: string) =>
      client.post<InvoiceDetail, Record<string, never>>(`/visits/${visitId}/invoices`, {}),
    onSuccess: async (_invoice, visitId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visits', 'charges', visitId] }),
        queryClient.invalidateQueries({ queryKey: ['visits', 'payments', visitId] }),
      ]);
    },
  });
}
