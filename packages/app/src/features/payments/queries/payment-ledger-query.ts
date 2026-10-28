/**
 * The clinic's payment ledger.
 *
 * Every figure comes from the API: the page's rows, the exact total behind them,
 * the collected sum for the whole filtered period, and the currency those amounts
 * are in. The key carries the period, method and page, so changing a filter cannot
 * show the previous window while the next request is in flight.
 */

import { useQuery } from '@tanstack/react-query';
import type { PaymentLedgerEntry } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface PaymentLedgerResponse {
  readonly period: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
  };
  readonly currencyCode: string;
  readonly items: readonly PaymentLedgerEntry[];
  readonly totalAmountMinor: number;
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export interface PaymentLedgerFilters {
  readonly from: string;
  readonly to: string;
  readonly method?: string | null;
  readonly page: number;
  readonly limit: number;
}

export function usePaymentLedger({ from, to, method, page, limit }: PaymentLedgerFilters) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['payments', 'ledger', { from, to, method: method ?? null, page, limit }],
    queryFn: () =>
      client.get<PaymentLedgerResponse>('/payments', {
        query: {
          from,
          to,
          ...(method ? { method } : {}),
          page,
          limit,
        },
      }),
    enabled: Boolean(from) && Boolean(to) && from <= to,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}
