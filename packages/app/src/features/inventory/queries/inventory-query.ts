/**
 * The clinic's inventory: its items and one item's stock ledger.
 *
 * Two queries rather than one because a movement is an item's own history: the
 * page draws every item without paying for every ledger, and opens one item's
 * movements only when the desk chooses that item. The movement key carries the
 * item id, so switching items cannot show the previous item's rows.
 *
 * The item list is short and changes only when somebody adds stock, so it takes a
 * minute of staleness like the treatment catalogue; a movement invalidates both
 * keys explicitly instead of waiting for the minute to pass.
 */

import { useQuery } from '@tanstack/react-query';
import type { InventoryItem, StockMovement } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

interface ItemsResponse {
  readonly items: readonly InventoryItem[];
}

interface MovementsResponse {
  readonly items: readonly StockMovement[];
}

export function useInventory() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => client.get<ItemsResponse>('/inventory/items'),
    staleTime: 60_000,
  });
}

export function useStockMovements(itemId: string | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['inventory', 'movements', itemId ?? ''],
    queryFn: () =>
      client.get<MovementsResponse>(
        `/inventory/items/${encodeURIComponent(itemId ?? '')}/movements`,
      ),
    enabled: Boolean(itemId),
    staleTime: 30_000,
  });
}
