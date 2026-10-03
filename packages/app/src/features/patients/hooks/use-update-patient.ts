/**
 * Editing a patient.
 *
 * The counterpart to `useRegisterPatient`, and it differs in one way that matters:
 * it invalidates instead of prefetching, because the server answers an edit with
 * 204 and no body. There is nothing to cache — the updated record has to be read
 * again, and refetching it is the only way the profile can show what was actually
 * stored rather than what the form believed it sent.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdatePatientInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useUpdatePatient(patientId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    // PUT, not PATCH: the body is the complete editable set, so an optional field
    // the user cleared arrives absent and is stored as null.
    mutationFn: (input: UpdatePatientInput) =>
      client.put<void, UpdatePatientInput>(`/patients/${patientId}`, input),
    onSuccess: async () => {
      // The profile shows the name, and every list shows the name, so both would
      // keep rendering the old one until a refetch. The prefix covers all of them,
      // including the pages cached under search terms this visit never used.
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}
