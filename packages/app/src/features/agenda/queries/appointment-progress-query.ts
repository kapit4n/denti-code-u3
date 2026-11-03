import { useQuery } from '@tanstack/react-query';
import type { AppointmentProgressEntry } from '@denti-code-u3/domain';
import type { AppointmentId } from '@denti-code-u3/types';

import { useApiClient } from '../../../query/api-client-provider.js';

interface AppointmentProgressResponse {
  readonly items: readonly AppointmentProgressEntry[];
}

export function appointmentProgressKey(appointmentId: AppointmentId) {
  return ['appointments', appointmentId, 'progress'] as const;
}

export function useAppointmentProgress(appointmentId: AppointmentId) {
  const client = useApiClient();

  return useQuery({
    queryKey: appointmentProgressKey(appointmentId),
    queryFn: () =>
      client.get<AppointmentProgressResponse>(`/appointments/${appointmentId}/progress`),
  });
}
