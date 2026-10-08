/**
 * Charting one tooth of a patient.
 *
 * **Nothing is written optimistically, and the chart is what refetches — not the
 * patient.** A charted tooth does not touch the profile's row, so invalidating
 * `['patients']` as an edit would refetch the whole profile for pixels that
 * cannot differ. The key this mutation invalidates is exactly the one
 * `usePatientOdontogram` read, and the server's own answer is what appears in the
 * chart.
 *
 * The body is only the finding — the tooth, its condition, its surfaces and an
 * optional note — because the patient is the path, the dentition is a fact about
 * the tooth number, and the id and the time are the server's (ADR 0014). Charting
 * the same tooth twice is not an error on the wire: the server replaces the
 * tooth's state, so this write is an edit, never a second row.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  OdontogramCondition,
  OdontogramEntryRecord,
  OdontogramSurface,
} from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface RecordOdontogramEntryVariables {
  readonly patientId: string;
  readonly tooth: string;
  readonly condition: OdontogramCondition;
  readonly surfaces: readonly OdontogramSurface[];
  readonly notes?: string;
}

export function useRecordOdontogramEntry() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      patientId,
      tooth,
      condition,
      surfaces,
      notes,
    }: RecordOdontogramEntryVariables) =>
      client.post<
        OdontogramEntryRecord,
        {
          tooth: string;
          condition: OdontogramCondition;
          surfaces: OdontogramSurface[];
          notes?: string;
        }
      >(`/patients/${patientId}/odontogram/entries`, {
        tooth,
        condition,
        surfaces: [...surfaces],
        ...(notes && notes.trim() ? { notes } : {}),
      }),
    onSuccess: async (_entry, { patientId }) => {
      await queryClient.invalidateQueries({ queryKey: ['patients', 'odontogram', patientId] });
    },
  });
}
