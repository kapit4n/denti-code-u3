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
      setExportMessage(`Saved ${savedName}`);
    } catch {
      setExportFailure('The report could not be saved on this device.');
    }
  };

  const isPending = clinic.isPending || report.isPending;
  const failure = report.error;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="mt-1 text-muted-foreground">
          Appointments, production, collections and occupancy for the period you choose.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange aria-hidden className="h-5 w-5 text-muted-foreground" />
            Period and filters
          </CardTitle>
          <CardDescription>
            Dates are read in the clinic’s time zone
            {timeZone ? ` (${timeZone})` : ''}. The last day is included.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-4" onSubmit={handleExport}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-from">From</Label>
              <Input
                id="report-from"
                data-testid="report-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-to">To</Label>
              <Input
                id="report-to"
                data-testid="report-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-dentist">Clinician</Label>
              <select
                id="report-dentist"
                data-testid="report-dentist"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={dentistId}
                onChange={(event) => setDentistId(event.target.value)}
              >
                <option value="">All clinicians</option>
                {(dentists.data?.items ?? []).map((dentist) => (
                  <option key={dentist.id} value={dentist.id}>
                    {dentist.fullName}
                    {dentist.isActive ? '' : ' (inactive)'}
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
                Export CSV
              </Button>
            </div>
          </form>

          {!rangeIsValid && from && to ? (
            <p className="mt-3 text-sm text-destructive" data-testid="report-range-error">
              The start date must be on or before the end date.
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
            <span data-testid="report-error">The report could not be built for this period.</span>
          </CardContent>
        </Card>
      ) : null}

      <section aria-label="Report summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Appointments"
          value={report.data?.appointments.total ?? 0}
          description={selectedDentistName ?? 'Booked in the period'}
          icon={CalendarRange}
          accent="blue"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="Completed"
          value={report.data?.appointments.completed ?? 0}
          description="Finished appointments"
          accent="green"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="Cancelled"
          value={report.data?.appointments.cancelled ?? 0}
          description="Cancelled appointments"
          accent="rose"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="No-show"
          value={report.data?.appointments.noShow ?? 0}
          description="Patients who did not attend"
          accent="slate"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="Production"
          value={
            report.data ? money(report.data.production.totalMinor, report.data.currencyCode) : '—'
          }
          description="Net charge value raised"
          accent="violet"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="Collections"
          value={
            report.data ? money(report.data.collections.totalMinor, report.data.currencyCode) : '—'
          }
          description="Payments received, clinic-wide"
          accent="green"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="Outstanding"
          value={
            report.data ? money(report.data.outstanding.totalMinor, report.data.currencyCode) : '—'
          }
          description="Open invoices, as of now"
          accent="amber"
          isLoading={isPending}
          error={failure}
        />
        <StatCard
          title="Occupancy"
          value={report.data ? percent(report.data.occupancy.rate) : '—'}
          description={
            report.data?.occupancy.capacityMinutes
              ? `${report.data.occupancy.bookedMinutes} of ${report.data.occupancy.capacityMinutes} min`
              : 'No recorded opening hours'
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
            <CardTitle>Clinician performance</CardTitle>
            <CardDescription>
              Appointments and production are attributed to the clinician on the row. Collections
              are not split here: payments carry no clinician.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.data.dentists.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No clinician activity in this period.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Clinician</TableHead>
                    <TableHead className="text-right">Appointments</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Cancelled</TableHead>
                    <TableHead className="text-right">No-show</TableHead>
                    <TableHead className="text-right">Booked min</TableHead>
                    <TableHead className="text-right">Production</TableHead>
                    <TableHead className="text-right">Occupancy</TableHead>
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
