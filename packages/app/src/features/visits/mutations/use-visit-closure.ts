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
 * **The two closures are two paths, not one endpoint with a field.** `reopen` is
 * bodyless, and `complete` carries only the planned lines the closure dialog ticked;
 * neither may be asked for the other's move, so the path is a lookup rather than a
 * parameter a caller could typo into a 404: the only values the type admits are the
 * two the API implements.
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

/** One planned line the closure selected, with the plan that owns it. */
export interface VisitClosurePlanItem {
  readonly planId: string;
  readonly itemId: string;
}

export interface TransitionVisitVariables {
  readonly visitId: string;
  readonly to: VisitClosure;
  /**
   * The open planned lines the closure dialog selected.
   *
   * Only `complete` reads it. An empty list closes the visit without completing a
   * line, which is the old bodyless closure the API still accepts.
   */
  readonly treatmentPlanItems?: readonly VisitClosurePlanItem[];
}

export function useVisitClosure() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, to, treatmentPlanItems }: TransitionVisitVariables) => {
      const selected = to === 'COMPLETED' ? (treatmentPlanItems ?? []) : [];

      return client.post<
        Visit,
        { readonly treatmentPlanItems: readonly VisitClosurePlanItem[] } | undefined
      >(
        `/visits/${visitId}/${CLOSURE_PATH[to]}`,
        // `undefined` rather than `{}` when nothing was selected: the closure is
        // bodyless then, and a JSON body the endpoint never reads is a place a
        // client could believe a field was accepted.
        selected.length > 0 ? { treatmentPlanItems: selected } : undefined,
      );
    },
    onSuccess: async (visit) => {
      await invalidateVisitQueries(queryClient, visit.patientId);
    },
  });
}
