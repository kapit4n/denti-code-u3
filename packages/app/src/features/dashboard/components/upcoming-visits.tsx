/**
 * The next few bookings, across today and the following days.
 *
 * Ordered and truncated by the API. Cancelled appointments are already excluded
 * server-side, so this list never has to decide what counts as "upcoming".
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';

import { useUpcomingVisits } from '../hooks/use-dashboard-stats.js';

export function UpcomingVisits() {
  const { data, isPending, error } = useUpcomingVisits();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Visits</CardTitle>
        <CardDescription>Next scheduled appointments</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <ul aria-hidden className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </ul>
        ) : error ? (
          <p className="text-sm text-destructive">Upcoming visits could not be loaded.</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((visit) => (
              <li key={visit.id} className="rounded-lg border p-3">
                <p className="truncate text-sm font-medium">
                  {visit.firstName} {visit.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{formatDateTime(visit.startsAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No upcoming visits.</p>
        )}
      </CardContent>
    </Card>
  );
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
