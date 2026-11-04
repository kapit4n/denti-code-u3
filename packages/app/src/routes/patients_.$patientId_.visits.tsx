/**
 * A patient's complete visit history: `/patients/$patientId/visits`.
 *
 * The trailing underscore on `$patientId_` keeps this route a tree-sibling of the
 * profile, exactly like the edit page. The profile has no `<Outlet />`, so nesting
 * the history under it would render nothing.
 */

import { createFileRoute } from '@tanstack/react-router';

import { PatientVisitHistory } from '../features/visits/components/patient-visit-history.js';

export const Route = createFileRoute('/patients_/$patientId_/visits')({
  component: PatientVisitsPage,
});

function PatientVisitsPage() {
  const { patientId } = Route.useParams();
  return <PatientVisitHistory patientId={patientId} />;
}
