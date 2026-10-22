/**
 * Applying one movement to one item.
 *
 * The API answers with the updated item and the movement it wrote; the page does
 * not patch either locally. Both the item list and the selected item's ledger are
 * invalidated, because the movement changed the cached level and added a row.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InventoryItem, StockMovement } from '@denti-code-u3/domain';
import type { RecordStockMovementInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface RecordedMovement {
  readonly item: InventoryItem;
  readonly movement: StockMovement;
}

export function useRecordStockMovement(itemId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RecordStockMovementInput) =>
      client.post<RecordedMovement, RecordStockMovementInput>(
        `/inventory/items/${encodeURIComponent(itemId)}/movements`,
        input,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] });
      await queryClient.invalidateQueries({
        queryKey: ['inventory', 'movements', itemId],
      });
    },
  });
}
