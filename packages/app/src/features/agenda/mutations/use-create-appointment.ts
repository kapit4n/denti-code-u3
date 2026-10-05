/**
 * Booking an appointment.
 *
 * The create half of the write side, and a mutation for the same reason the reschedule
 * is one: the endpoint, the body and the response type live in one file, so the
 * component never learns that the URL exists.
 *
 * **Nothing is written to the cache.** The dialog closes when the API agrees and the
 * grid redraws from the refetch, so the block the user is looking for is the server's
 * answer rather than a splice of the form's values into the agenda. A booking that
 * appeared instantly and then vanished would be worse than one that takes a moment
 * (ADR 0007).
 *
 * The response is the `AgendaEntry` the row became, not the entity that was sent —
 * so the end time, the patient's name and the chair's name come from the server
 * rather than from anything this app worked out.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AgendaEntry } from '@denti-code-u3/domain';
import type { CreateAppointmentInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';
import { invalidateScheduleQueries } from './invalidate-schedule-queries.js';

export function useCreateAppointment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    // `CreateAppointmentInput`, the request's own type — not the form's. The dialog has
    // already turned the clinic's wall clock into an instant by the time this is
    // called, so what crosses here is the request and should be typed as one; taking
    // the form's type would make the conversion optional to the compiler's eye.
    mutationFn: (input: CreateAppointmentInput) =>
      client.post<AgendaEntry, CreateAppointmentInput>('/appointments', input),
    onSuccess: async (entry) => {
      // The same invalidation a drag does: the grid, the dashboard's "today" and the
      // patient's own next appointment are all answers to the schedule.
      await invalidateScheduleQueries(queryClient, entry.patientId);
    },
  });
}
