/**
 * Consuming stock for one treatment.
 *
 * The API answers with the supply line, the item's new stock and the movement it
 * appended. Three reads can show those facts, so all three are invalidated: the
 * visit's supplies, the inventory list the picker draws, and the item's ledger. The
 * treatment records themselves do not change, so that key is left alone.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InventoryItem, StockMovement, TreatmentSupply } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface RecordTreatmentSupplyVariables {
  readonly visitId: string;
  readonly treatmentRecordId: string;
  readonly itemId: string;
  readonly quantity: number;
}

export interface RecordedTreatmentSupply {
  readonly supply: TreatmentSupply;
  readonly item: InventoryItem;
  readonly movement: StockMovement;
}

export function useRecordTreatmentSupply() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      visitId,
      treatmentRecordId,
      itemId,
      quantity,
    }: RecordTreatmentSupplyVariables) =>
      client.post<RecordedTreatmentSupply, { itemId: string; quantity: number }>(
        `/visits/${visitId}/treatments/${treatmentRecordId}/supplies`,
        { itemId, quantity },
      ),
    onSuccess: async (result, { visitId }) => {
      await queryClient.invalidateQueries({
        queryKey: ['visits', 'treatment-supplies', visitId],
      });
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'movements', result.item.id] });
    },
  });
}
