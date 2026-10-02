import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { useApiClient } from '../../../query/api-client-provider.js';

export interface TodayAppointment {
  id: string;
  patientId: string;
  startsAt: string;
  status: string;
}

export function TodayAppointments() {
  const client = useApiClient();
  const { data, isLoading } = useQuery<{ items: TodayAppointment[] }>({
    queryKey: ['dashboard', 'today-appointments'],
    queryFn: async () => {
      const response = await client.get('/api/v1/dashboard/today-appointments');
      const json = await (response as Response).json();
      return json as { items: TodayAppointment[] };
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s Appointments</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : data?.items?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appointments scheduled for today.</p>
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
                    {new Date(item.startsAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    - {item.status}
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
