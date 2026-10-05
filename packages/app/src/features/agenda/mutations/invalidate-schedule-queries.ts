/**
 * Which cached views a change to the schedule invalidates.
 *
 * One list, one function, because the two schedule mutations have to invalidate the
 * same things and a second copy of the list is a second thing to forget. Getting it
 * wrong is quiet and expensive in both directions: miss one and the receptionist
 * cancels an appointment and the day's list still shows it; add one that does not
 * belong and every keystroke in a search box refetches the whole dashboard.
 *
 * Prefixes rather than exact keys, so a range the user has not navigated to yet is
 * still correct when they get there.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { PatientId } from '@denti-code-u3/types';

/**
 * Refetches everything whose answer the schedule just changed.
 *
 * @param patientId The patient on the appointment that moved. Their profile's next
 *   appointment is named rather than the whole `['patients']` prefix: a reschedule
 *   changes one patient's next visit, and invalidating the prefix would also refetch
 *   every list and every odontogram on the screen.
 */
export async function invalidateScheduleQueries(
  queryClient: QueryClient,
  patientId: PatientId,
): Promise<void> {
  // The grid, and the dashboard's answers to "what is happening today" and "who is
  // coming next" — all of which are a function of the schedule.
  await queryClient.invalidateQueries({ queryKey: ['agenda'] });
  await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  await queryClient.invalidateQueries({ queryKey: ['patients', 'profile', patientId] });
}
