import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../query/api-client-provider.js';

export interface DashboardStats {
  appointments: number;
  completed: number;
  pending: number;
  cancelled: number;
  totalPatients: number;
  revenue: number;
  pendingTreatments: number;
  occupancyRate: number;
}

export function useDashboardStats() {
  const client = useApiClient();

  return useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const response = await client.get('/api/v1/dashboard/stats');
      const data = await (response as Response).json();
      return data as DashboardStats;
    },
  });
}
