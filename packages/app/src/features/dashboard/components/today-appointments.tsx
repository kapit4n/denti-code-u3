/**
 * Today's agenda.
 *
 * Renders exactly what the API returns and nothing more. Notably absent: a
 * client-side filter over a wider fetch, a locally computed "now" line, and a
 * hard-coded empty state. The empty state is whatever the API says it is.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';

import { useTodayAppointments } from '../hooks/use-dashboard-stats.js';

export function TodayAppointments() {
  const { data, isPending, error } = useTodayAppointments();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s Appointments</CardTitle>
        <CardDescription>Times in this device&apos;s timezone</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <ul aria-hidden className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </ul>
        ) : error ? (
          <p className="text-sm text-destructive">Today&apos;s appointments could not be loaded.</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((appointment) => (
              <li
                key={appointment.id}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {appointment.firstName} {appointment.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatTimeOfDay(appointment.startsAt)} · {appointment.durationMinutes} min
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{appointment.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No appointments scheduled for today.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Time of day in the browser's locale.
 *
 * `startsAt` is stored in UTC by contract (ADR 0012). The clinic's timezone is
 * not known to the client yet, so the device's own zone is used and the header
 * says so plainly. Converting to the clinic zone needs the clinic record in the
 * client; until then, mislabelling these as "clinic time" would be the bug.
 */
function formatTimeOfDay(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
