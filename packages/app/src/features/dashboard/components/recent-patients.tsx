/**
 * The clinic's newest patient records.
 *
 * Each row links straight to the profile, because the profile is the central
 * clinical context (Milestone 4) — the dashboard is a way in, not a second place
 * to read a patient's details. The avatar is initials rather than a photograph:
 * the clinic holds no image for a patient yet, and a placeholder portrait would
 * suggest one that does not exist.
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
import { UserRound } from 'lucide-react';

import { useTranslation } from '../../../i18n/index.js';
import { useRecentPatients } from '../hooks/use-dashboard-stats.js';

export function RecentPatients() {
  const { t } = useTranslation();
  const { data, isPending, error } = useRecentPatients();

  return (
    <Card>
      <CardHeader className="relative">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="absolute right-4 top-4 text-muted-foreground"
        >
          <Link to="/patients">{t('dashboard.recentPatients.viewAll')}</Link>
        </Button>
        <CardTitle>{t('dashboard.recentPatients.title')}</CardTitle>
        <CardDescription>{t('dashboard.recentPatients.description')}</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <ul aria-hidden className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </ul>
        ) : error ? (
          <p className="text-sm text-destructive">{t('dashboard.recentPatients.error')}</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((patient) => (
              <li key={patient.id}>
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: patient.id }}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-metric-green-soft text-sm font-semibold text-metric-green">
                    {initials(patient.firstName, patient.lastName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {patient.firstName} {patient.lastName}
                    </span>
                    {patient.recordNumber ? (
                      <span className="block text-xs text-muted-foreground">
                        {patient.recordNumber}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-metric-green-soft text-metric-green">
              <UserRound aria-hidden className="h-6 w-6" />
            </span>
            <p className="text-sm text-muted-foreground">{t('dashboard.recentPatients.empty')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Two initials, or whatever is available. Never an empty circle. */
function initials(firstName: string, lastName: string): string {
  const letters = `${firstName.charAt(0)}${lastName.charAt(0)}`.trim();
  return letters.length > 0 ? letters.toUpperCase() : '?';
}
