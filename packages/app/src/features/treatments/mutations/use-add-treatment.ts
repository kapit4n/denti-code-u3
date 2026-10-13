/**
 * Adding a treatment to the clinic's catalogue.
 *
 * **Nothing is written optimistically, and the catalogue is what refetches.**
 * The row appears carrying the server's `id`, which is the only part of it this
 * app did not supply — a treatment shown before the API accepted it would offer
 * the workspace's picker a procedure that does not exist, and the picker is the
 * one place a phantom entry would do real damage rather than merely embarrass
 * itself. The key invalidated is exactly the one `useTreatments` read.
 *
 * The body is `CreateTreatmentInput` — the request's own type, not the form's.
 * The form holds the price as a person typed it (major units, with a decimal
 * point) and has already handed the mutation an integer of minor units by the
 * time this is called, so typing the input as the form's state would make that
 * conversion optional to the compiler's eye. Blank code and description are
 * dropped rather than sent as `''`: the API refuses a blank code, and a field
 * nobody filled in is a field the record should not have.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TreatmentCatalogueItem } from '@denti-code-u3/domain';
import type { CreateTreatmentInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useAddTreatment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTreatmentInput) =>
      client.post<TreatmentCatalogueItem, CreateTreatmentInput>('/treatments', {
        ...input,
        ...(input.code?.trim() ? { code: input.code.trim() } : { code: null }),
        ...(input.description?.trim()
          ? { description: input.description.trim() }
          : { description: null }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['treatments'] });
    },
  });
}
