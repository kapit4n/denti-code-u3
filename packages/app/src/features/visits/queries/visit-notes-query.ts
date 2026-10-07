/**
 * The notes written on one visit.
 *
 * The shape is the endpoint's own `{ notes: [...] }` rather than a bare array, because
 * the route answers with a named collection for the reason the timeline does: a list
 * that arrives bare is a list whose envelope a future field has to break to add.
 *
 * **This hook is only ever called from the notes section, which is mounted only while
 * that section is open** — so "fetch what you draw" holds without an `enabled` flag
 * held back at the call site. The summary is what a workspace opens on, and a request
 * whose answer no pixel on screen can show is a request that exists to be forgotten
 * when it changes. Nothing conditional happens in the component either: the section is
 * a component, and React's own mounting is the condition.
 *
 * There is no second hook beside it: notes have no address other than their visit
 * (ADR 0023).
 */

import { useQuery } from '@tanstack/react-query';
import type { ClinicalNote } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface VisitNotesResponse {
  readonly notes: readonly ClinicalNote[];
}

export function useVisitNotes(visitId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['visits', 'notes', visitId],
    queryFn: () => client.get<VisitNotesResponse>(`/visits/${visitId}/notes`),
    enabled: visitId.length > 0,
  });
}
