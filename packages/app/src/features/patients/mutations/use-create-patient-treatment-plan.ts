/**
 * Proposing a treatment plan for a patient.
 *
 * **Nothing is written optimistically, and the plans list is what refetches — not
 * the whole profile.** A new plan does not touch the patient's row, so
 * invalidating `['patients']` would refetch the profile for pixels that cannot
 * differ; the key this mutation invalidates is exactly the one
 * `usePatientTreatmentPlans` read, and the server's own answer is what appears in
 * the section.
 *
 * The body is the plan's own fields — an optional title and the items — because the
 * patient is the path, and the id, the status and the timestamps are the server's
 * (ADR 0014). An item names a treatment, an FDI tooth, a quantity and an optional
 * price in minor units; the section builds those from what the clinician typed.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TreatmentPlanSummary } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface TreatmentPlanDraftItem {
  readonly treatmentId?: string;
  readonly tooth?: string;
  readonly quantity?: number;
  readonly estimatedPriceMinor?: number;
  readonly notes?: string;
}

export interface CreatePatientTreatmentPlanVariables {
  readonly patientId: string;
  readonly title?: string;
  readonly items: readonly TreatmentPlanDraftItem[];
}

interface CreateTreatmentPlanResponse {
  readonly plan: TreatmentPlanSummary;
}

export function useCreatePatientTreatmentPlan() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ patientId, ...body }: CreatePatientTreatmentPlanVariables) =>
      client.post<CreateTreatmentPlanResponse, { title?: string; items: TreatmentPlanDraftItem[] }>(
        `/patients/${patientId}/treatment-plans`,
        { ...body, items: [...body.items] },
      ),
    onSuccess: async (_result, { patientId }) => {
      await queryClient.invalidateQueries({ queryKey: ['patients', 'treatment-plans', patientId] });
    },
  });
}
