/**
 * Starting a visit from its booking.
 *
 * The write behind the agenda's treatment choices. Starting a visit is one move in
 * the domain — the booking and the visit are written together (ADR 0021) — so the
 * panel calls this once and then leaves for the workspace the server named.
 *
 * The appointment, the agenda and the patient's profile all change with this write,
 * which is why the invalidation list is the schedule's plus the visits'. The plan
 * item the caller picked is not part of the request: it is carried to the workspace
 * as a search parameter, where the treatment form asks the clinician to confirm it.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StartedVisit } from '@denti-code-u3/domain';
import type { AppointmentId } from '@denti-code-u3/types';

import { useApiClient } from '../../../query/api-client-provider.js';
import { invalidateScheduleQueries } from '../../agenda/mutations/invalidate-schedule-queries.js';
import { invalidateVisitQueries } from './invalidate-visit-queries.js';

export interface StartVisitVariables {
  readonly appointmentId: AppointmentId;
}

export function useStartVisit() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appointmentId }: StartVisitVariables) =>
      client.post<StartedVisit, { appointmentId: AppointmentId }>('/visits', { appointmentId }),
    onSuccess: async ({ appointment, visit }) => {
      await Promise.all([
        invalidateScheduleQueries(queryClient, visit.patientId),
        invalidateVisitQueries(queryClient, visit.patientId),
        queryClient.invalidateQueries({ queryKey: ['appointments', appointment.id, 'progress'] }),
      ]);
    },
  });
}
