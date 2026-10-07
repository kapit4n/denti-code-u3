/**
 * Filing a prescription on a visit.
 *
 * **Nothing is written optimistically, and the prescriptions list is what refetches —
 * not the visit.** A prescription does not change the visit's row (its status, its
 * times and its summary are untouched), so invalidating `['visits']` wholesale would
 * refetch the visit and the patient's profile for pixels that cannot differ — exactly
 * what the notes mutation argues, for the same reason. The key invalidated is exactly
 * the one the read used, and the server's own answer is what becomes the row in the
 * list: a course shown before the server accepted it is a clinical claim the record
 * does not contain.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MedicationRoute, Prescription } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface CreatePrescriptionVariables {
  readonly visitId: string;
  readonly medication: string;
  readonly dosage: string;
  readonly route: MedicationRoute;
  readonly frequency: string;
  readonly durationDays: number;
  readonly instructions?: string;
}

export function useCreatePrescription() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      visitId,
      medication,
      dosage,
      route,
      frequency,
      durationDays,
      instructions,
    }: CreatePrescriptionVariables) =>
      client.post<
        Prescription,
        {
          medication: string;
          dosage: string;
          route: MedicationRoute;
          frequency: string;
          durationDays: number;
          instructions?: string;
        }
      >(`/visits/${visitId}/prescriptions`, {
        // Trimmed on the way out, so the server is not asked to store what the
        // boxes' edges happen to hold. A blank instruction is dropped entirely:
        // an empty string is a field that was typed and then forgotten, and the
        // server stores null for it — a request that omits it and one that
        // empties it look the same to the prescription, which is the only way
        // they should.
        medication: medication.trim(),
        dosage: dosage.trim(),
        route,
        frequency: frequency.trim(),
        durationDays,
        instructions: instructions?.trim() || undefined,
      }),
    onSuccess: async (_prescription, { visitId }) => {
      await queryClient.invalidateQueries({ queryKey: ['visits', 'prescriptions', visitId] });
    },
  });
}
