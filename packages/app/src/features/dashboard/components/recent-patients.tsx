/**
 * The clinic's newest patient records.
 *
 * Each row links straight to the profile, because the profile is the central
 * clinical context (Milestone 4) — the dashboard is a way in, not a second place
 * to read a patient's details.
 */

import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';

import { useRecentPatients } from '../hooks/use-dashboard-stats.js';

export function RecentPatients() {
  const { data, isPending, error } = useRecentPatients();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Patients</CardTitle>
        <CardDescription>Newest records in this clinic</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? (
          <ul aria-hidden className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </ul>
        ) : error ? (
          <p className="text-sm text-destructive">Recent patients could not be loaded.</p>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-2">
            {data.items.map((patient) => (
              <li key={patient.id} className="rounded-lg border">
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: patient.id }}
                  className="block p-3 hover:bg-muted"
                >
                  <p className="truncate text-sm font-medium">
                    {patient.firstName} {patient.lastName}
                  </p>
                  {patient.recordNumber ? (
                    <p className="text-xs text-muted-foreground">{patient.recordNumber}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No patients registered yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
