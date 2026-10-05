/**
 * Moving an appointment's time.
 *
 * The write half of a drag. It is a mutation rather than a direct `fetch` in the
 * component for the same reason the registration is: the endpoint, the body and the
 * response type live in one file, and the component does not know the URL exists.
 *
 * **Nothing is written to the cache.** The grid has already moved the block, because
 * FullCalendar moved it, and this asks the API to agree; the query is then invalidated
 * so the grid is redrawn from the server's answer. A block that stays where the
 * receptionist put it while the write is in flight is the library's optimistic
 * feedback, not a second source of truth — and if the server refuses, the component
 * reverts and the refetch has nothing to contradict (ADR 0007).
 *
 * Only the fields the gesture actually changed are sent. The endpoint treats an
 * absent field as "leave it as it is", so a drag cannot clear the chair on its way
 * past.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AgendaEntry } from '@denti-code-u3/domain';
import type { AppointmentId } from '@denti-code-u3/types';
import type { RescheduleAppointmentInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';
import { invalidateScheduleQueries } from './invalidate-schedule-queries.js';

/**
 * The appointment to move, and where to.
 *
 * The reschedule body with the id added, so a reschedule intent can be handed over
 * as it is. Structural rather than imported from the calendar adapter on purpose: this
 * is a transport concern, and a rename in an adapter should not be able to reach it.
 * The body is built from named fields, so nothing else can ride along.
 */
export type RescheduleAppointmentVariables = RescheduleAppointmentInput & {
  readonly appointmentId: AppointmentId;
};

export function useRescheduleAppointment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appointmentId, ...input }: RescheduleAppointmentVariables) =>
      client.put<AgendaEntry, RescheduleAppointmentInput>(
        `/appointments/${appointmentId}/schedule`,
        input,
      ),
    onSuccess: async (entry) => {
      await invalidateScheduleQueries(queryClient, entry.patientId);
    },
  });
}
