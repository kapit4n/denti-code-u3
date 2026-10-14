/**
 * Marking one item of a treatment plan done.
 *
 * **Bodyless, and the plans list is what refetches.** The item is the path, so the
 * only thing the body could carry is a timestamp the server owns (ADR 0014); the
 * endpoint is idempotent, so a second click after the row was already done is not
 * an error and needs no client-side guard beyond disabling the button.
 *
 * The invalidation key is the one `usePatientTreatmentPlans` read — the same list
 * the create form refetches — so a completed item and a newly proposed plan agree
 * about what the patient has been offered.
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
      await queryClient.invalidateQueries({ queryKey: ['patients', 'treatment-plans', patientId] });
    },
  });
}
