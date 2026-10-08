/**
 * Raising a charge on a visit.
 *
 * **Nothing is written optimistically, and the charges list is what refetches — not
 * the visit.** A charge does not change the visit's row (its status, its times and
 * its summary are untouched), so invalidating `['visits']` wholesale would refetch
 * the visit and the patient's profile for pixels that cannot differ — exactly what
 * the prescriptions mutation argues, for the same reason. The key invalidated is the
 * one the read used, and the server's own answer is what becomes the row in the
 * list: a price shown before the server accepted it is a claim on the patient's
 * balance the record does not contain.
 *
 * The amounts leave as **integer minor units** — the wire shape money always travels
 * in here, from the presentation's major-unit boxes, divided nowhere.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Charge } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface CreateChargeVariables {
  readonly visitId: string;
  readonly description: string;
  /** Defaults to one single service when omitted. */
  readonly quantity?: number;
  readonly unitPriceMinor: number;
  /** A zero discount is dropped, so a charge without one is not stored with one. */
  readonly discountMinor?: number;
}

export function useCreateCharge() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      visitId,
      description,
      quantity,
      unitPriceMinor,
      discountMinor,
    }: CreateChargeVariables) =>
      client.post<
        Charge,
        {
          description: string;
          quantity?: number;
          unitPriceMinor: number;
          discountMinor?: number;
        }
      >(`/visits/${visitId}/charges`, {
        // Trimmed on the way out, so the server is not asked to store what the
        // box's edges happen to hold.
        description: description.trim(),
        ...(quantity !== undefined ? { quantity } : {}),
        unitPriceMinor,
        // A zero discount is the domain's default; sending it would be a body
        // that says what is already true.
        ...(discountMinor !== undefined && discountMinor > 0 ? { discountMinor } : {}),
      }),
    onSuccess: async (_charge, { visitId }) => {
      await queryClient.invalidateQueries({ queryKey: ['visits', 'charges', visitId] });
    },
  });
}
