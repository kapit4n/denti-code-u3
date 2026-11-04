/**
 * Finishing one treatment recorded on a visit.
 *
 * The server owns the finish time and answers with the record as it now stands. The
 * invalidation is exactly the records key the section read, so the end time appears
 * because the API said so, not because the browser guessed it. A record linked to a
 * planned line also refreshes the plan read, whose session history carries the same
 * end time; supplies and the visit row cannot change here, so neither is refetched.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TreatmentRecord } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface FinishVisitTreatmentVariables {
  readonly visitId: string;
  readonly patientId: string;
  readonly treatmentRecordId: string;
  /** When set, the plan read carries this record as a session and must refetch. */
  readonly treatmentPlanItemId?: string | null;
}

export function useFinishVisitTreatment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, treatmentRecordId }: FinishVisitTreatmentVariables) =>
      client.post<TreatmentRecord, undefined>(
        `/visits/${visitId}/treatments/${treatmentRecordId}/finish`,
        undefined,
      ),
    onSuccess: async (_record, { visitId, patientId, treatmentPlanItemId }) => {
      await queryClient.invalidateQueries({ queryKey: ['visits', 'treatments', visitId] });
      if (treatmentPlanItemId) {
        await queryClient.invalidateQueries({
          queryKey: ['patients', 'treatment-plans', patientId],
        });
      }
    },
  });
}
