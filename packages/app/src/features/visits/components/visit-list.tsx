/**
 * The visit directory at `/visits`.
 *
 * A page of visits, whoever they belong to — the request carries no clinician and
 * the server narrows a clinician's answer to their own rows. The table therefore
 * shows `dentistName` on every row rather than assuming the reader's: a manager
 * needs to know whose visit this was, and a clinician's rows all say the same name
 * rather than leaving the column blank and making the screen quietly different.
 *
 * Times are rendered in the clinic's zone, or not at all. The settings request is
 * separate from the list, so a list that arrives first waits for the clock instead
 * of printing a plausible wrong hour.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@denti-code-u3/ui';

import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { formatClinicDayTime, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { useVisitList } from '../queries/visit-list-query.js';
import { visitStatusClassName, visitStatusLabel } from '../visit-status-presentation.js';

const PAGE_SIZE = 20;

export function VisitList() {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useVisitList({ page, limit: PAGE_SIZE });
  const { data: clinic } = useClinicSettings();

  const pagination = data?.pagination;
  const rows = data?.items ?? [];
  const timeZone = clinic?.timeZone;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Visits</h1>
        <p className="text-muted-foreground">
          {pagination ? `${pagination.total} on record` : 'Loading visits'}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Recent visits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading visits…</p>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              The visit list could not be loaded.
            </p>
          ) : rows.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Clinician</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((visit) => (
                    <TableRow key={visit.id}>
                      <TableCell>
                        <Link
                          to="/visits/$visitId"
                          params={{ visitId: visit.id }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {visit.patientName}
                        </Link>
                      </TableCell>
                      <TableCell>{visit.dentistName ?? 'Unassigned'}</TableCell>
                      <TableCell>
                        {visit.startedAt ? (
                          timeZone ? (
                            formatClinicDayTime(visit.startedAt, timeZone)
                          ) : (
                            <span className="text-muted-foreground">
                              {READING_THE_CLINIC_CLOCK}
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground">Not started</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={visitStatusClassName(visit.status)}>
                          {visitStatusLabel(visit.status)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pagination && pagination.totalPages > 1 ? (
                <nav aria-label="Pagination" className="flex items-center justify-between">
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <Button
                    variant="outline"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </nav>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No visits on record yet. A visit starts from the agenda or as a walk-in.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
