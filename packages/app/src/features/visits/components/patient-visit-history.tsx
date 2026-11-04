/**
 * One patient's complete visit history.
 *
 * The profile deliberately stops at the visits that still need attention; this
 * page is the other half of the question. It reads the uncapped timeline endpoint
 * (ADR 0023), so nothing is silently omitted from a clinical history.
 *
 * Times are drawn in the clinic's zone, or the page says it is reading the clock
 * instead of falling back to the visitor's zone. That is the same rule as the
 * profile and the workspace, and it matters most on a history where every row is
 * an instant.
 */

import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
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
import { usePatient } from '../../patients/hooks/use-patients.js';
import { usePatientVisits } from '../queries/patient-visits-query.js';
import { visitStatusClassName, visitStatusLabel } from '../visit-status-presentation.js';

export function PatientVisitHistory({ patientId }: { readonly patientId: string }) {
  const { t } = useTranslation();
  const patientQuery = usePatient(patientId);
  const visitsQuery = usePatientVisits(patientId);
  const { data: clinic } = useClinicSettings();
  const timeZone = clinic?.timeZone;

  const patient = patientQuery.data;
  const patientName = patient
    ? (patient.preferredName ?? `${patient.firstName} ${patient.lastName}`)
    : undefined;
  const visits = visitsQuery.data?.visits ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/patients/$patientId" params={{ patientId }} data-testid="patient-history-back">
            <ArrowLeft aria-hidden className="mr-2 size-4" />
            {t('patients.history.back')}
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{t('patients.history.title')}</h1>
        {patient ? (
          <p className="text-muted-foreground">
            {patientName}
            {patient.recordNumber ? ` · ${patient.recordNumber}` : ''}
          </p>
        ) : null}
      </header>

      {patientQuery.error ? (
        <p role="alert" className="text-sm text-destructive">
          {patientQuery.error instanceof Error &&
          'status' in patientQuery.error &&
          patientQuery.error.status === 404
            ? t('patients.history.notFound')
            : t('patients.history.loadError')}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {visitsQuery.isPending
              ? t('patients.history.loading')
              : t(
                  visits.length === 1
                    ? 'patients.history.recordCount.one'
                    : 'patients.history.recordCount.other',
                  { count: visits.length },
                )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visitsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t('patients.history.loading')}</p>
          ) : visitsQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t('patients.history.loadError')}
            </p>
          ) : visits.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('patients.history.started')}</TableHead>
                  <TableHead>{t('patients.history.ended')}</TableHead>
                  <TableHead>{t('patients.history.status')}</TableHead>
                  <TableHead>{t('patients.history.summary')}</TableHead>
                  <TableHead className="text-right">{t('patients.history.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visits.map((visit) => (
                  <TableRow key={visit.id}>
                    <TableCell>
                      {visit.startedAt ? (
                        timeZone ? (
                          formatClinicDayTime(visit.startedAt, timeZone)
                        ) : (
                          <span className="text-muted-foreground">
                            {t('patients.profile.readingClock')}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">
                          {t('patients.history.notStarted')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {visit.endedAt ? (
                        timeZone ? (
                          formatClinicDayTime(visit.endedAt, timeZone)
                        ) : (
                          <span className="text-muted-foreground">
                            {t('patients.profile.readingClock')}
                          </span>
                        )
                      ) : visit.status === 'OPEN' ? (
                        <span className="text-muted-foreground">
                          {t('patients.history.notEnded')}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={visitStatusClassName(visit.status)}>
                        {visitStatusLabel(t, visit.status)}
                      </span>
                    </TableCell>
                    <TableCell>{visit.summary ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to="/visits/$visitId" params={{ visitId: visit.id }}>
                          {t('patients.history.open')}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t('patients.history.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
