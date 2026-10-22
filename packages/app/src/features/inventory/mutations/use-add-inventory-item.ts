/**
 * Adding an item to the inventory.
 *
 * Nothing is optimistic. The row appears with the server's `id` after the
 * invalidation refetches the list, because the stock level and the opening
 * movement are both the server's answers — a row drawn from the form's values
 * would be a level the ledger has not recorded yet.
 *
 * The form holds the cost as a person types it (major units); the caller converts
 * it once to integer minor units before this mutation sees it.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InventoryItem } from '@denti-code-u3/domain';
import type { CreateInventoryItemInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useAddInventoryItem() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateInventoryItemInput) => {
      const response = await client.post<{ item: InventoryItem }, CreateInventoryItemInput>(
        '/inventory/items',
        {
          ...input,
          ...(input.sku?.trim() ? { sku: input.sku.trim() } : { sku: null }),
          ...(input.description?.trim()
            ? { description: input.description.trim() }
            : { description: null }),
        },
      );
      return response.item;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] });
    },
  });
}
