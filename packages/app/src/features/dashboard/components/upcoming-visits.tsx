/**
 * The next few bookings, across today and the following days.
 *
 * Ordered and truncated by the API. Cancelled appointments are already excluded
 * server-side, so this list never has to decide what counts as "upcoming".
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
import { CalendarClock } from 'lucide-react';

import { enumLabel, useTranslation } from '../../../i18n/index.js';
import { useUpcomingVisits } from '../hooks/use-dashboard-stats.js';

export function UpcomingVisits() {
  const { t } = useTranslation();
  const { data, isPending, error } = useUpcomingVisits();

  return (
    <Card>
      <CardHeader className="relative">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="absolute right-4 top-4 text-muted-foreground"
        >
          <Link to="/visits">{t('dashboard.upcomingVisits.viewAll')}</Link>
        </Button>
        <CardTitle>{t('dashboard.upcomingVisits.title')}</CardTitle>
        <CardDescription>{t('dashboard.upcomingVisits.description')}</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <ul aria-hidden className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </ul>
        ) : error ? (
          <p className="text-sm text-destructive">{t('dashboard.upcomingVisits.error')}</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((visit) => (
              <li
                key={visit.id}
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-metric-violet-soft text-metric-violet">
                  <CalendarClock aria-hidden className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {visit.firstName} {visit.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(visit.startsAt)}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                    STATUS_TONE_CLASS[toneForStatus(visit.status)],
                  )}
                >
                  {enumLabel(t, 'common.status', visit.status)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-metric-violet-soft text-metric-violet">
              <CalendarClock aria-hidden className="h-6 w-6" />
            </span>
            <p className="text-sm text-muted-foreground">{t('dashboard.upcomingVisits.empty')}</p>
          </div>
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
