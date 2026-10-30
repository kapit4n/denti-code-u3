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

import { Link } from '@tanstack/react-router';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@denti-code-u3/ui';

import { useLocale, useTranslation } from '../../../i18n/index.js';
import { useCalendarPreview } from '../hooks/use-dashboard-stats.js';

const WINDOW_DAYS = 14;

export function CalendarPreview() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isPending, error } = useCalendarPreview(WINDOW_DAYS);

  const busiest = data ? Math.max(1, ...data.items.map((day) => day.total)) : 1;

  return (
    <Card>
      <CardHeader className="relative">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="absolute right-4 top-4 text-muted-foreground"
        >
          <Link to="/agenda">{t('dashboard.todayAppointments.openAgenda')}</Link>
        </Button>
        <CardTitle>{t('dashboard.calendar.title')}</CardTitle>
        <CardDescription>
          {t('dashboard.calendar.description', { days: WINDOW_DAYS })}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <div aria-hidden className="h-24 animate-pulse rounded bg-muted" />
        ) : error ? (
          <p className="text-sm text-destructive">{t('dashboard.calendar.error')}</p>
        ) : data && data.items.length > 0 ? (
          <ul className="flex items-stretch gap-1.5">
            {data.items.map((day) => {
              const label = t('dashboard.calendar.barTitle', {
                date: day.day,
                total: day.total,
                completed: day.completed,
              });
              return (
                <li
                  key={day.day}
                  className="group flex flex-1 flex-col items-center gap-1"
                  aria-label={label}
                  title={label}
                >
                  <span
                    aria-hidden
                    className="text-[10px] font-medium tabular-nums text-muted-foreground"
                  >
                    {day.total}
                  </span>
                  <div aria-hidden className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{
                        height: `${Math.max(8, Math.round((day.total / busiest) * 100))}%`,
                      }}
                    />
                  </div>
                  <span
                    aria-hidden
                    className="flex flex-col items-center text-[10px] leading-tight text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {formatWeekday(day.day, locale)}
                    </span>
                    <span className="tabular-nums">{day.day.slice(8)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.calendar.empty', { days: WINDOW_DAYS })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatWeekday(isoDay: string, locale: string): string {
  const date = new Date(`${isoDay}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date);
}
