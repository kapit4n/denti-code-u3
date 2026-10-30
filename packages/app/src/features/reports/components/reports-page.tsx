/**
 * Reports: the clinic's period figures, and who did the work.
 *
 * The page is a filter plus a presentation of one API answer. It does not sum
 * charges, subtract payments or derive occupancy; those definitions live in the
 * reporting route, where both engines answer them the same way. In particular:
 *
 *  - **Collections are clinic-wide.** Payments carry no clinician, so the figure is
 *    not split when a dentist is selected, and the copy says so rather than leaving
 *    a manager to assume the filtered number is that clinician's takings.
 *  - **Unknown occupancy is an em dash.** No recorded opening hours is not an empty
 *    clinic, and `0%` would be a confident lie.
 *  - **Unassigned work stays visible.** A charge filed without a visit has no
 *    clinician; the table keeps it under "Unassigned" instead of hiding value.
 *
 * The default period is the clinic's current month to date, resolved in the clinic's
 * timezone once its settings arrive.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { formatMinorUnits } from '@denti-code-u3/domain';
import { AlertCircle, CalendarRange, Download, Gauge } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@denti-code-u3/ui';

import { useTranslation } from '../../../i18n/index.js';
import { usePlatform } from '../../../providers.js';
import { useDentists } from '../../agenda/queries/bookable-resources-query.js';
import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { defaultMonthToDatePeriod, type ClinicDatePeriod } from '../../clinic/clinic-period.js';
import { buildReportCsv, reportFileName } from '../report-csv.js';
import { useReportSummary } from '../queries/reports-query.js';
import { StatCard } from '../../dashboard/components/stat-card.js';

function money(minor: number, currencyCode: string | null): string {
  return `${formatMinorUnits(minor)}${currencyCode ? ` ${currencyCode}` : ''}`;
}

function percent(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

export function ReportsPage() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const clinic = useClinicSettings();
  const dentists = useDentists({ onlyActive: false });

  // `null` means "still following the clinic's default period"; once the operator
  // edits a date the value is theirs and the default must stop applying. Deriving it
  // this way rather than seeding state in an effect is what keeps the clinic clock out
  // of a render loop — the effect version wrote state on the same tick the clinic
  // arrived and lit React's cascading-render warning.
  const [editedPeriod, setEditedPeriod] = useState<ClinicDatePeriod | null>(null);
  const [dentistId, setDentistId] = useState('');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportFailure, setExportFailure] = useState<string | null>(null);

  const timeZone = clinic.data?.timeZone;

  // The default is the clinic's current month, resolved in the clinic's calendar.
  // Before the clinic record arrives there is no honest date to show, so the fields
  // stay empty and the query stays disabled.
  const period = useMemo(
    () => editedPeriod ?? (timeZone ? defaultMonthToDatePeriod(new Date(), timeZone) : null),
    [editedPeriod, timeZone],
  );
  const from = period?.from ?? '';
  const to = period?.to ?? '';

  const setFrom = (value: string) =>
    setEditedPeriod((current) => ({ from: value, to: current?.to ?? to }));
  const setTo = (value: string) =>
    setEditedPeriod((current) => ({ from: current?.from ?? from, to: value }));

  const rangeIsValid = from !== '' && to !== '' && from <= to;
  const report = useReportSummary({
    from,
    to,
    dentistId: dentistId || null,
  });

  const selectedDentistName = useMemo(
    () => dentists.data?.items.find((dentist) => dentist.id === dentistId)?.fullName ?? null,
    [dentists.data, dentistId],
  );

  const handleExport = async (event: FormEvent) => {
    event.preventDefault();
    if (!report.data) {
      return;
    }

    setExportFailure(null);
    setExportMessage(null);

    try {
      const savedName = await platform.saveFile(
        reportFileName(report.data),
        buildReportCsv(report.data),
      );
      setExportMessage(t('reports.export.saved', { name: savedName }));
    } catch {
      setExportFailure(t('reports.export.failure'));
    }
  };

  const isPending = clinic.isPending || report.isPending;
  const failure = report.error;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('reports.title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('reports.description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange aria-hidden className="h-5 w-5 text-muted-foreground" />
            {t('reports.filters.title')}
          </CardTitle>
          <CardDescription>
            {t('reports.filters.description', {
              timeZone: timeZone ? ` (${timeZone})` : '',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-4" onSubmit={handleExport}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-from">{t('reports.filters.from')}</Label>
              <Input
                id="report-from"
                data-testid="report-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-to">{t('reports.filters.to')}</Label>
              <Input
                id="report-to"
                data-testid="report-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-dentist">{t('reports.filters.clinician')}</Label>
              <select
                id="report-dentist"
                data-testid="report-dentist"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={dentistId}
                onChange={(event) => setDentistId(event.target.value)}
              >
                <option value="">{t('reports.filters.allClinicians')}</option>
                {(dentists.data?.items ?? []).map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.fullName}
                    {dentist.isActive ? '' : t('reports.filters.inactiveSuffix')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                data-testid="report-export"
                disabled={!report.data || !rangeIsValid || report.isFetching}
              >
                <Download aria-hidden className="mr-2 h-4 w-4" />
                {t('reports.export')}
              </Button>
            </div>
          </form>

          {!rangeIsValid && from && to ? (
            <p className="mt-3 text-sm text-destructive" data-testid="report-range-error">
              {t('reports.filters.rangeError')}
            </p>
          ) : null}

          {exportMessage ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {exportMessage}
            </p>
          ) : null}
          {exportFailure ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {exportFailure}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {failure ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-destructive">
            <AlertCircle aria-hidden className="h-5 w-5" />
            <span data-testid="report-error">{t('reports.loadError')}</span>
          </CardContent>
        </Card>
      ) : null}

      <section
        aria-label={t('reports.summary.aria')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          title={t('reports.stat.appointments.title')}
          testId="Appointments"
          value={report.data?.appointments.total ?? 0}
          description={selectedDentistName ?? t('reports.stat.appointments.description')}
          icon={CalendarRange}
          accent="blue"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.completed.title')}
          testId="Completed"
          value={report.data?.appointments.completed ?? 0}
          description={t('reports.stat.completed.description')}
          accent="green"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.cancelled.title')}
          testId="Cancelled"
          value={report.data?.appointments.cancelled ?? 0}
          description={t('reports.stat.cancelled.description')}
          accent="rose"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.noShow.title')}
          testId="No-show"
          value={report.data?.appointments.noShow ?? 0}
          description={t('reports.stat.noShow.description')}
          accent="slate"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.production.title')}
          testId="Production"
          value={
            report.data ? money(report.data.production.totalMinor, report.data.currencyCode) : '—'
          }
          description={t('reports.stat.production.description')}
          accent="violet"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.collections.title')}
          testId="Collections"
          value={
            report.data ? money(report.data.collections.totalMinor, report.data.currencyCode) : '—'
          }
          description={t('reports.stat.collections.description')}
          accent="green"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.outstanding.title')}
          testId="Outstanding"
          value={
            report.data ? money(report.data.outstanding.totalMinor, report.data.currencyCode) : '—'
          }
          description={t('reports.stat.outstanding.description')}
          accent="amber"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title={t('reports.stat.occupancy.title')}
          testId="Occupancy"
          value={report.data ? percent(report.data.occupancy.rate) : '—'}
          description={
            report.data?.occupancy.capacityMinutes
              ? t('reports.stat.occupancy.description', {
                  booked: report.data.occupancy.bookedMinutes,
                  capacity: report.data.occupancy.capacityMinutes,
                })
              : t('reports.stat.occupancy.noHours')
          }
          icon={Gauge}
          accent="blue"
          isLoading={isPending}
          error={failure}
          isUnknown={report.data?.occupancy.rate === null}
        />
      </section>

      {!report.data ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.performance.title')}</CardTitle>
            <CardDescription>{t('reports.performance.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {report.data.dentists.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('reports.performance.empty')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.column.clinician')}</TableHead>
                    <TableHead className="text-right">{t('reports.column.appointments')}</TableHead>
                    <TableHead className="text-right">{t('reports.column.completed')}</TableHead>
                    <TableHead className="text-right">{t('reports.column.cancelled')}</TableHead>
                    <TableHead className="text-right">{t('reports.column.noShow')}</TableHead>
                    <TableHead className="text-right">
                      {t('reports.column.bookedMinutes')}
                    </TableHead>
                    <TableHead className="text-right">{t('reports.column.production')}</TableHead>
                    <TableHead className="text-right">{t('reports.column.occupancy')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.dentists.map((dentist) => (
                    <TableRow
                      key={dentist.dentistId ?? 'unassigned'}
                      data-testid="report-dentist-row"
                    >
                      <TableCell className="font-medium" data-testid="report-dentist-name">
                        {dentist.dentistName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dentist.appointments}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{dentist.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">{dentist.cancelled}</TableCell>
                      <TableCell className="text-right tabular-nums">{dentist.noShow}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dentist.bookedMinutes}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(dentist.productionMinor, report.data.currencyCode)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(dentist.occupancyRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
