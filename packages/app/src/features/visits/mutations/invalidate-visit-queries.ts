/**
 * Which cached views a change to a visit invalidates.
 *
 * One list, one function, because the two closures have to invalidate the same
 * things and a second copy of the list is a second thing to forget.
 *
 * **What is *not* on the list, and why that is deliberate:** the agenda and the
 * dashboard. Completing a visit does not move its appointment (ADR 0022) and a
 * walk-in was never on the grid, so no schedule answer changes — invalidating
 * `['agenda']` would refetch a grid whose pixels cannot differ, and the dashboard's
 * totals are a function of appointments and payments, neither of which this write
 * touches. The patient's profile is named rather than the whole `['patients']`
 * prefix: the profile carries this visit's status and end time, the list carries
 * somebody else's search results.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { PatientId } from '@denti-code-u3/types';

export async function invalidateVisitQueries(
  queryClient: QueryClient,
  patientId: PatientId,
): Promise<void> {
  // The workspace itself, and any second screen holding a copy of this visit.
  await queryClient.invalidateQueries({ queryKey: ['visits'] });
  // The profile's recent-visits card, which reports the same row.
  await queryClient.invalidateQueries({ queryKey: ['patients', 'profile', patientId] });
}
