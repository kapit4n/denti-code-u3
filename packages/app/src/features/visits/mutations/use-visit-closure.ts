/**
 * Closing a visit, and opening one again.
 *
 * One hook for both, the way `use-transition-appointment-status.ts` is one hook for
 * every appointment transition: the legal moves are a table in the domain
 * (`allowedVisitTransitions`) and the API refuses the rest, so two hooks would be
 * two callers of one rule that could drift apart about which of them is reachable.
 * Which buttons appear is decided at render time by asking the domain — this file
 * only knows the paths.
 *
 * **The two closures are two paths, not one endpoint with a field.** `complete` and
 * `reopen` are bodyless and neither may be asked for the other's move, so the path
 * is a lookup rather than a parameter a caller could typo into a 404: the only
 * values the type admits are the two the API implements.
 *
 * **Nothing here decides anything about the appointment.** Both writes leave the
 * booking exactly as it was (ADR 0022), which is also why the invalidation list has
 * no agenda in it (see `invalidate-visit-queries.ts`).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Visit } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';
import type { VisitClosure } from '../visit-status-presentation.js';
import { invalidateVisitQueries } from './invalidate-visit-queries.js';

export type { VisitClosure };

const CLOSURE_PATH: Readonly<Record<VisitClosure, 'complete' | 'reopen'>> = {
  COMPLETED: 'complete',
  OPEN: 'reopen',
};

export interface TransitionVisitVariables {
  readonly visitId: string;
  readonly to: VisitClosure;
}

export function useVisitClosure() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, to }: TransitionVisitVariables) =>
      // `undefined` body, not `{}`: both endpoints are bodyless, and a JSON body
      // they never read is a place a client could believe a field was accepted.
      client.post<Visit, undefined>(`/visits/${visitId}/${CLOSURE_PATH[to]}`, undefined),
    onSuccess: async (visit) => {
      await invalidateVisitQueries(queryClient, visit.patientId);
    },
  });
}
