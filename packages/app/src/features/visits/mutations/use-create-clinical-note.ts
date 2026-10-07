/**
 * Filing a clinical note.
 *
 * **Nothing is written optimistically, and the notes list is what refetches — not the
 * visit.** A note does not change the visit's row (its status, its times and its
 * summary are untouched), so invalidating `['visits']` as the closures do would
 * refetch the visit and the patient's profile for pixels that cannot differ. The key
 * this mutation invalidates is exactly the one the read used, and the server's own
 * answer is what appears in the list: a note shown before the server accepted it is
 * the one screen in the app that could claim a clinical record exists when it does not.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ClinicalNote } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface CreateClinicalNoteVariables {
  readonly visitId: string;
  readonly body: string;
}

export function useCreateClinicalNote() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, body }: CreateClinicalNoteVariables) =>
      client.post<ClinicalNote, { body: string }>(`/visits/${visitId}/notes`, { body }),
    onSuccess: async (_note, { visitId }) => {
      await queryClient.invalidateQueries({ queryKey: ['visits', 'notes', visitId] });
    },
  });
}
