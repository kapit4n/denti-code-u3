/**
 * The files attached to one visit.
 *
 * The shape is the endpoint's own `{ attachments: [...] }` rather than a bare
 * array, for the same reason the notes read answers with a named collection:
 * a list that arrives bare is a list whose envelope a future field has to break
 * to add.
 *
 * **This hook is only ever called from the files section, which is mounted only
 * while that section is open** — so "fetch what you draw" holds without an
 * `enabled` flag, for the same reason the notes read gives. Files have no
 * address other than their visit (ADR 0023), so there is no second hook beside
 * it.
 */

import { useQuery } from '@tanstack/react-query';
import type { VisitAttachment } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitAttachmentsResponse {
  readonly attachments: readonly VisitAttachment[];
}

export function useVisitAttachments(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'attachments', visitId],
    queryFn: () => client.get<VisitAttachmentsResponse>(`/visits/${visitId}/attachments`),
    enabled: visitId.length > 0,
  });
}
