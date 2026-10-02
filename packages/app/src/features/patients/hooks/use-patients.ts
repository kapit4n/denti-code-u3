import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../query/api-client-provider.js';

export interface Patient {
  id: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  recentVisits?: unknown[];
  upcomingAppointment?: unknown;
}

export function usePatients(params?: { q?: string; page?: number; limit?: number }) {
  const client = useApiClient();
  const query = params?.q ?? '';
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;

  return useQuery<{ items: Patient[]; total: number; page: number; limit: number }>({
    queryKey: ['patients', { query, page, limit }],
    queryFn: async () => {
      const url = `/api/v1/patients?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`;
      const response = await client.get(url);
      const json = await (response as Response).json();
      return json as { items: Patient[]; total: number; page: number; limit: number };
    },
  });
}

export function usePatient(id: string) {
  const client = useApiClient();

  return useQuery<Patient>({
    queryKey: ['patients', id],
    queryFn: async () => {
      const response = await client.get(`/api/v1/patients/${id}`);
      const json = await (response as Response).json();
      return json as Patient;
    },
    enabled: Boolean(id),
  });
}
