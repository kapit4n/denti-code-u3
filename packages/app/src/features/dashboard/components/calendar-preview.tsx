/**
 * Booking density for the coming days.
 *
 * The counts are grouped by the API (one row per day) rather than counted in the
 * browser, so this component renders a list and does no arithmetic. The bars are
 * proportional to the busiest day in the window, which keeps a quiet week
 * readable without inventing a scale.
 *
 * Deliberately still a density chart and not a month grid. The dashboard's job is
 * "how busy is the coming fortnight", and the Agenda already owns the editable
 * month calendar — a second one here would be two calendars that can disagree about
 * what is booked, which is worse than one honest sparkline. Only days with bookings
 * get a bar: an empty day drawn as a zero-height bar looks like a chart of a very
 * quiet fortnight, and there is no way to tell "closed" from "nothing booked".
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';

import { useCalendarPreview } from '../hooks/use-dashboard-stats.js';

const WINDOW_DAYS = 14;

export function CalendarPreview() {
  const { data, isPending, error } = useCalendarPreview(WINDOW_DAYS);

  const busiest = data ? Math.max(1, ...data.items.map((day) => day.total)) : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar Preview</CardTitle>
        <CardDescription>Bookings per day, next {WINDOW_DAYS} days</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <div aria-hidden className="h-24 animate-pulse rounded bg-muted" />
        ) : error ? (
          <p className="text-sm text-destructive">The calendar preview could not be loaded.</p>
        ) : data && data.items.length > 0 ? (
          <ul className="flex items-end gap-1.5" style={{ height: '7rem' }}>
            {data.items.map((day) => (
              <li
                key={day.day}
                className="group flex flex-1 flex-col justify-end gap-1"
                title={`${day.day}: ${day.total} bookings, ${day.completed} completed`}
              >
                <div
                  className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(6, Math.round((day.total / busiest) * 100))}%` }}
                />
                <span className="text-center text-[10px] tabular-nums text-muted-foreground">
                  {day.day.slice(8)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No bookings in the next {WINDOW_DAYS} days.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
