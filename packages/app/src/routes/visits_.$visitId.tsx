/**
 * The visit workspace at `/visits/$visitId` (Milestone 6).
 *
 * The file is named `visits_.$visitId` rather than living in a `visits/$visitId`
 * folder for the same reason the patient profile is: the underscore opts this route
 * out of nesting, so a future list and the workspace are sibling pages rather than a
 * list that has to render an `<Outlet />` for anything it wants to link to.
 *
 * The route owns the id and nothing else. Every question the screen asks — the
 * visit, the patient, the clinic's zone, the clinician's name — is asked by
 * `VisitWorkspace` through its hooks, which is the arrangement every other detail
 * route here uses: no loaders, so a slow answer is a loading state in the component
 * that needs it rather than a route that cannot render at all.
 *
 * The `/visits` list is its sibling, `visits.tsx` (ADR 0031). This route stays the
 * workspace for one visit, reached from the directory or from the patient whose
 * record it belongs to.
 */

import { createFileRoute } from '@tanstack/react-router';

import { VisitWorkspace } from '../features/visits/components/visit-workspace.js';

export interface VisitSearch {
  /** The planned line the agenda chose before opening this workspace. */
  readonly treatmentPlanItemId?: string;
}

export const Route = createFileRoute('/visits_/$visitId')({
  validateSearch: (search: Record<string, unknown>): VisitSearch => ({
    treatmentPlanItemId:
      typeof search.treatmentPlanItemId === 'string' ? search.treatmentPlanItemId : undefined,
  }),
  component: VisitPage,
});

function VisitPage() {
  const { visitId } = Route.useParams();
  const { treatmentPlanItemId } = Route.useSearch();
  return <VisitWorkspace visitId={visitId} initialTreatmentPlanItemId={treatmentPlanItemId} />;
}
