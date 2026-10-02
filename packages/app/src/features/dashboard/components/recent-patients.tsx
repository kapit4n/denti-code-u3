import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { useApiClient } from '../../../query/api-client-provider.js';

export interface RecentPatient {
  id: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export function RecentPatients() {
  const client = useApiClient();
  const { data, isLoading } = useQuery<{ items: RecentPatient[] }>({
    queryKey: ['dashboard', 'recent-patients'],
    queryFn: async () => {
      const response = await client.get('/api/v1/dashboard/recent-patients');
      const json = await (response as Response).json();
      return json as { items: RecentPatient[] };
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Patients</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : data?.items?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent patients.</p>
        ) : (
          <div className="space-y-2">
            {data?.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {item.firstName} {item.lastName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
