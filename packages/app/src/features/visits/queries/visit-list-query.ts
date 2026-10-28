/**
 * The clinic's visit directory.
 *
 * The server decides what "the clinic's" means: a clinician's request comes back
 * narrowed to their own visits, and a manager's comes back with everyone's. There
 * is no role check here on purpose — a screen that filtered client-side would be a
 * screen that had the other clinicians' rows in memory to hide them.
 *
 * The row shape is the domain's `VisitListEntry`, imported rather than copied.
 * Names travel with it, so the list is one request rather than one per row.
 */

import { useQuery } from '@tanstack/react-query';
import type { VisitListEntry } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitListResponse {
  readonly items: readonly VisitListEntry[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export function useVisitList(options: { readonly page: number; readonly limit: number }) {
  const client = useApiClient();
  const { page, limit } = options;

  return useQuery({
    queryKey: ['visits', 'list', { page, limit }],
    queryFn: () => client.get<VisitListResponse>('/visits', { query: { page, limit } }),
    // Keeps the previous page on screen while the next one loads, instead of
    // flashing an empty table on every page change.
    placeholderData: (previous) => previous,
  });
}
