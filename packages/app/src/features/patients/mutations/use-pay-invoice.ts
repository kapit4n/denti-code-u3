import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Payment, PaymentMethod } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface PayInvoiceVariables {
  readonly invoiceId: string;
  readonly patientId: string;
  readonly method: PaymentMethod;
  readonly amountMinor: number;
  readonly reference?: string;
}

export function usePayInvoice() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ invoiceId, method, amountMinor, reference }: PayInvoiceVariables) =>
      client.post<
        Payment,
        {
          method: PaymentMethod;
          amountMinor: number;
          reference?: string;
        }
      >(`/invoices/${invoiceId}/payments`, {
        method,
        amountMinor,
        ...(reference && reference.trim().length > 0 ? { reference: reference.trim() } : {}),
      }),
    onSuccess: async (_payment, { patientId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patients', 'profile', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'invoices', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'balance', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'statement', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['invoices', 'detail'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['visits', 'payments'] }),
      ]);
    },
  });
}
