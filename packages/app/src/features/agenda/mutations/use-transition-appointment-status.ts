/**
 * Moving an appointment to a new status.
 *
 * One mutation for every transition — checking a patient in, starting treatment,
 * completing, cancelling, undoing a cancellation. Not one hook per status: the legal
 * moves are a table in the domain (`allowedAppointmentTransitions`) and the API
 * refuses the rest, so a hook per status would be seven hooks that all do the same
 * request and disagree about which of them are reachable.
 *
 * Which buttons the panel shows is decided by asking the domain, not by keeping a
 * second copy of the table here (rule 1). The server has the last word regardless: a
 * status that reserves a slot is also a scheduling act, so it goes through the same
 * conflict check as a move and can come back refused.
 *
 * `reason` is sent only when there is one. The domain requires it for a
 * cancellation, and it is the caller that knows it — a panel that sent an empty
 * string would turn a 422 naming the business rule into a 422 naming a field.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AgendaEntry } from '@denti-code-u3/domain';
import type { AppointmentId } from '@denti-code-u3/types';
import type { TransitionAppointmentInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';
import { invalidateScheduleQueries } from './invalidate-schedule-queries.js';

export type TransitionAppointmentVariables = TransitionAppointmentInput & {
  readonly appointmentId: AppointmentId;
};

export function useTransitionAppointmentStatus() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appointmentId, ...input }: TransitionAppointmentVariables) =>
      client.post<AgendaEntry, TransitionAppointmentInput>(
        `/appointments/${appointmentId}/status`,
        input,
      ),
    onSuccess: async (entry) => {
      await invalidateScheduleQueries(queryClient, entry.patientId);
    },
  });
}
