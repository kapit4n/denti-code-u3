/**
 * Recording a payment against a visit's bill.
 *
 * **Nothing is written optimistically, and the payments list is what refetches — not
 * the visit.** A payment does not change the visit's row (its status, its times and
 * its summary are untouched), so invalidating `['visits']` wholesale would refetch
 * the visit and the patient's profile for pixels that cannot differ — exactly what
 * the charges mutation argues, for the same reason.
 *
 * **The charges list is invalidated beside the payments list.** A settlement does
 * not stop at the money: the server stamps the bill it settles *invoiced*, and both
 * the charges section's rows and this section's "what is left to settle" read from
 * that same list — so a payment arriving must refetch it, or the Charges section
 * would still draw a bill the record says was already folded into an invoice. The
 * key invalidated is the one each read used, and the server's own answer is what
 * becomes the row in the register: money shown on screen before the server accepted
 * it is a receipt the record does not contain.
 *
 * The amount leaves as an **integer minor unit** — the wire shape money always
 * travels in here, from the presentation's major-unit box, divided nowhere.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Payment, PaymentMethod } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface CreatePaymentVariables {
  readonly visitId: string;
  readonly method: PaymentMethod;
  /** Strictly positive minor units, never more than the bill's un-invoiced total. */
  readonly amountMinor: number;
  /** Optional free text, e.g. a card's last digits. Blank is dropped. */
  readonly reference?: string;
}

export function useCreatePayment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, method, amountMinor, reference }: CreatePaymentVariables) =>
      client.post<
        Payment,
        {
          method: PaymentMethod;
          amountMinor: number;
          reference?: string;
        }
      >(`/visits/${visitId}/payments`, {
        method,
        amountMinor,
        // Trimmed on the way out, so the server is not asked to store what the
        // box's edges happen to hold — a blank is dropped rather than sent.
        ...(reference && reference.trim().length > 0 ? { reference: reference.trim() } : {}),
      }),
    onSuccess: async (_payment, { visitId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visits', 'payments', visitId] }),
        queryClient.invalidateQueries({ queryKey: ['visits', 'charges', visitId] }),
      ]);
    },
  });
}
