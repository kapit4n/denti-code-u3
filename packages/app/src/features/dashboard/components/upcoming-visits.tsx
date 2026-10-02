import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { useApiClient } from '../../../query/api-client-provider.js';

export interface UpcomingVisit {
  id: string;
  patientId: string;
  startsAt: string;
  status: string;
}

export function UpcomingVisits() {
  const client = useApiClient();
  const { data, isLoading } = useQuery<{ items: UpcomingVisit[] }>({
    queryKey: ['dashboard', 'upcoming-visits'],
    queryFn: async () => {
      const response = await client.get('/api/v1/dashboard/upcoming-visits');
      const json = await (response as Response).json();
      return json as { items: UpcomingVisit[] };
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Visits</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : data?.items?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming visits.</p>
        ) : (
          <div className="space-y-2">
            {data?.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">Patient {item.patientId.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.startsAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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
