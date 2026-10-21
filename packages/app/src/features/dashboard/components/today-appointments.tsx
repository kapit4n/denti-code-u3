/**
 * Today's agenda.
 *
 * Renders exactly what the API returns and nothing more. Notably absent: a
 * client-side filter over a wider fetch, a locally computed "now" line, and a
 * hard-coded empty state. The empty state is whatever the API says it is.
 *
 * The status badge prints the payload's own status string ("CONFIRMED"), not a
 * prettified label: the e2e spec reads that string straight off the panel to prove
 * the value came from the server, and a "Confirmed" that looked nicer would be a
 * second, unverified source of truth for the same fact.
 */

import { Link } from '@tanstack/react-router';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  STATUS_TONE_CLASS,
  toneForStatus,
} from '@denti-code-u3/ui';
import { CalendarDays } from 'lucide-react';

import { useTodayAppointments } from '../hooks/use-dashboard-stats.js';

export function TodayAppointments() {
  const { data, isPending, error } = useTodayAppointments();

  return (
    <Card>
      {/*
        The action is a direct sibling of `CardTitle`, not wrapped with it in a
        `<div>`. The dashboard spec locates this card by taking the heading's
        grandparent, which is only the `Card` itself while `CardTitle` is a direct
        child of `CardHeader` — wrapping the two in a layout div would silently move
        the scope up a level. Absolute positioning keeps that DOM shape.
      */}
      <CardHeader className="relative">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="absolute right-4 top-4 text-muted-foreground"
        >
          <Link to="/agenda">Open agenda</Link>
        </Button>
        <CardTitle>Today&apos;s Appointments</CardTitle>
        <CardDescription>Times in this device&apos;s timezone</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <ul aria-hidden className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </ul>
        ) : error ? (
          <p className="text-sm text-destructive">Today&apos;s appointments could not be loaded.</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((appointment) => (
              <li
                key={appointment.id}
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"
              >
                <span className="flex h-11 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatTimeOfDay(appointment.startsAt)}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {appointment.firstName} {appointment.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{appointment.durationMinutes} min</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                    STATUS_TONE_CLASS[toneForStatus(appointment.status)],
                  )}
                >
                  {appointment.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-metric-blue-soft text-metric-blue">
              <CalendarDays aria-hidden className="h-6 w-6" />
            </span>
            <p className="text-sm text-muted-foreground">No appointments scheduled for today.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/agenda">Open agenda</Link>
            </Button>
          </div>
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
