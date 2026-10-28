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

import { useTranslation } from '../../../i18n/index.js';
import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { formatClinicDayTime } from '../../clinic/format-clinic-time.js';
import { useVisitList } from '../queries/visit-list-query.js';
import { visitStatusClassName, visitStatusLabel } from '../visit-status-presentation.js';

const PAGE_SIZE = 20;

export function VisitList() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useVisitList({ page, limit: PAGE_SIZE });
  const { data: clinic } = useClinicSettings();

  const pagination = data?.pagination;
  const rows = data?.items ?? [];
  const timeZone = clinic?.timeZone;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('visits.list.title')}</h1>
        <p className="text-muted-foreground">
          {pagination
            ? t(
                pagination.total === 1
                  ? 'visits.list.recordCount.one'
                  : 'visits.list.recordCount.other',
                { count: pagination.total },
              )
            : t('visits.list.loading')}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('visits.list.recent')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPending ? (
            <p className="text-sm text-muted-foreground">{t('visits.list.loadingRows')}</p>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {t('visits.list.loadError')}
            </p>
          ) : rows.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('visits.list.patient')}</TableHead>
                    <TableHead>{t('visits.list.clinician')}</TableHead>
                    <TableHead>{t('visits.list.started')}</TableHead>
                    <TableHead>{t('visits.list.status')}</TableHead>
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
                      <TableCell>{visit.dentistName ?? t('visits.list.unassigned')}</TableCell>
                      <TableCell>
                        {visit.startedAt ? (
                          timeZone ? (
                            formatClinicDayTime(visit.startedAt, timeZone)
                          ) : (
                            <span className="text-muted-foreground">
                              {t('common.readingClinicClock')}
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground">
                            {t('visits.list.notStarted')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={visitStatusClassName(visit.status)}>
                          {visitStatusLabel(t, visit.status)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pagination && pagination.totalPages > 1 ? (
                <nav
                  aria-label={t('visits.list.paginationAria')}
                  className="flex items-center justify-between"
                >
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('visits.list.previous')}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {t('visits.list.pageOf', {
                      page: pagination.page,
                      totalPages: pagination.totalPages,
                    })}
                  </p>
                  <Button
                    variant="outline"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('visits.list.next')}
                  </Button>
                </nav>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('visits.list.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
