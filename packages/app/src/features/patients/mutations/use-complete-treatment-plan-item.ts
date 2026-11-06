/**
 * Marking one item of a treatment plan done.
 *
 * **Bodyless, and the plans list is what refetches.** The item is the path, so the
 * only thing the body could carry is a timestamp the server owns (ADR 0014); the
 * endpoint is idempotent, so a second click after the row was already done is not
 * an error and needs no client-side guard beyond disabling the button.
 *
 * **Completion now bills too, so more than the plan changes.** The API raises the
 * line's charge and issues its invoice in the same call, which moves the balance,
 * the invoice list, the statement and the patient list's outstanding figure. One
 * invalidation list covers all of them, so the plan and the money cannot disagree.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface CompleteTreatmentPlanItemVariables {
  readonly patientId: string;
  readonly planId: string;
  readonly itemId: string;
}

export function useCompleteTreatmentPlanItem() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ patientId, planId, itemId }: CompleteTreatmentPlanItemVariables) =>
      client.post<void, undefined>(
        `/patients/${patientId}/treatment-plans/${planId}/items/${itemId}/complete`,
        undefined,
      ),
    onSuccess: async (_result, { patientId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patients', 'treatment-plans', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'profile', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'invoices', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'balance', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'statement', patientId] }),
        queryClient.invalidateQueries({ queryKey: ['patients', 'list'] }),
      ]);
    },
  });
}
