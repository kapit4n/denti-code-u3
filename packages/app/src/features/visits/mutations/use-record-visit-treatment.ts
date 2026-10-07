/**
 * Recording a treatment performed in a visit.
 *
 * **Nothing is written optimistically, and the records list is what refetches — not
 * the visit.** A treatment record does not change the visit's row (its status, its
 * times and its summary are untouched), so invalidating `['visits']` wholesale
 * would refetch the visit and the patient's profile for pixels that cannot differ —
 * exactly what the notes mutation argues, for the same reason. The key invalidated
 * is precisely the one the read used, and the server's own answer is what becomes
 * the row in the list: a record shown before the server accepted it is a clinical
 * claim the record does not contain.
 *
 * The catalogue is not invalidated either: writing a record changes no treatment's
 * facts, so a refetch of the picker's options would throw away a minute of staleness
 * for items that did not move.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TreatmentRecord } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface RecordVisitTreatmentVariables {
  readonly visitId: string;
  readonly treatmentId: string;
  readonly tooth?: string | null;
  readonly notes?: string | null;
}

export function useRecordVisitTreatment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, treatmentId, tooth, notes }: RecordVisitTreatmentVariables) =>
      client.post<TreatmentRecord, { treatmentId: string; tooth?: string; notes?: string }>(
        `/visits/${visitId}/treatments`,
        {
          treatmentId,
          // Trimmed on the way out, and a blank is dropped: an empty string is a
          // field that was typed and then forgotten, and the server stores nil for
          // it — a request that omits it and one that empties it look the same to
          // the record, which is the only way they should.
          tooth: tooth?.trim() || undefined,
          notes: notes?.trim() || undefined,
        },
      ),
    onSuccess: async (_record, { visitId }) => {
      await queryClient.invalidateQueries({ queryKey: ['visits', 'treatments', visitId] });
    },
  });
}
