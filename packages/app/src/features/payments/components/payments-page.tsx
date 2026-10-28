/**
 * The clinic's payment ledger.
 *
 * A period filter and the rows the API returned. The page does not add the amounts:
 * the collected figure is the server's sum over the same filter, so turning a page
 * cannot make the period's takings look smaller, and the currency travels with the
 * answer rather than being assumed from the browser.
 *
 * Recording money is deliberately absent. A payment belongs to the visit whose bill
 * it settles, where the domain can refuse more than is owed and write the invoice,
 * payment and allocation together. This screen answers "what came in", not "take
 * this much".
 *
 * The default period is the clinic's month to date. The clinic's zone arrives in a
 * separate request, so the fields stay empty and the query stays disabled until
 * there is an honest calendar to ask about.
 */

import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { formatMinorUnits } from '@denti-code-u3/domain';
import { AlertCircle, CalendarRange, Receipt } from 'lucide-react';

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
import { defaultMonthToDatePeriod, type ClinicDatePeriod } from '../../clinic/clinic-period.js';
import { formatClinicDayTime } from '../../clinic/format-clinic-time.js';
import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { paymentMethodLabel, paymentMethodOptions } from '../payment-method-presentation.js';
import { usePaymentLedger } from '../queries/payment-ledger-query.js';

const PAGE_SIZE = 20;

function money(minor: number | undefined, currencyCode: string | null): string {
  if (minor === undefined) {
    return '—';
  }
  return `${formatMinorUnits(minor)}${currencyCode ? ` ${currencyCode}` : ''}`;
}

export function PaymentsPage() {
  const { t, locale } = useTranslation();
  const clinic = useClinicSettings();

  // `null` follows the clinic's default until the operator edits a date; from then
  // on the value is theirs. Deriving it instead of seeding state in an effect keeps
  // the clinic clock out of a render loop, the same shape the reports page uses.
  const [editedPeriod, setEditedPeriod] = useState<ClinicDatePeriod | null>(null);
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);

  const timeZone = clinic.data?.timeZone;
  const period = useMemo(
    () => editedPeriod ?? (timeZone ? defaultMonthToDatePeriod(new Date(), timeZone) : null),
    [editedPeriod, timeZone],
  );
  const from = period?.from ?? '';
  const to = period?.to ?? '';
  const rangeIsValid = from !== '' && to !== '' && from <= to;

  const ledger = usePaymentLedger({
    from,
    to,
    method: method || null,
    page,
    limit: PAGE_SIZE,
  });

  const changeFrom = (value: string) => {
    setEditedPeriod((current) => ({ from: value, to: current?.to ?? to }));
    setPage(1);
  };
  const changeTo = (value: string) => {
    setEditedPeriod((current) => ({ from: current?.from ?? from, to: value }));
    setPage(1);
  };
  const changeMethod = (value: string) => {
    setMethod(value);
    setPage(1);
  };

  const pagination = ledger.data?.pagination;
  const rows = ledger.data?.items ?? [];
  const currencyCode = ledger.data?.currencyCode ?? clinic.data?.currency ?? null;
  const isPending = clinic.isPending || ledger.isPending;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('payments.title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('payments.description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange aria-hidden className="h-5 w-5 text-muted-foreground" />
            {t('payments.filters.title')}
          </CardTitle>
          <CardDescription>
            {t('payments.filters.description', {
              timeZone: timeZone ? ` (${timeZone})` : '',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="payments-from">{t('payments.filters.from')}</Label>
              <Input
                id="payments-from"
                data-testid="payments-from"
                type="date"
                value={from}
                onChange={(event) => changeFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="payments-to">{t('payments.filters.to')}</Label>
              <Input
                id="payments-to"
                data-testid="payments-to"
                type="date"
                value={to}
                onChange={(event) => changeTo(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="payments-method">{t('payments.filters.method')}</Label>
              <select
                id="payments-method"
                data-testid="payments-method"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={method}
                onChange={(event) => changeMethod(event.target.value)}
              >
                <option value="">{t('payments.filters.allMethods')}</option>
                {paymentMethodOptions(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!rangeIsValid && from && to ? (
            <p className="mt-3 text-sm text-destructive" data-testid="payments-range-error">
              {t('payments.filters.rangeError')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section aria-label={t('payments.title')} className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('payments.summary.collected')}</CardDescription>
            <CardTitle className="text-3xl tabular-nums" data-testid="payments-collected">
              {isPending ? '—' : money(ledger.data?.totalAmountMinor, currencyCode)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('payments.summary.collectedDescription')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Receipt aria-hidden className="h-4 w-4" />
              {t('payments.summary.countLabel')}
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums" data-testid="payments-count">
              {isPending ? '—' : (pagination?.total ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('payments.summary.countDescription')}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('payments.ledger.title')}</CardTitle>
          <CardDescription>{t('payments.ledger.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPending ? (
            <p className="text-sm text-muted-foreground">{t('payments.loading')}</p>
          ) : ledger.error ? (
            <p
              role="alert"
              data-testid="payments-error"
              className="flex items-center gap-2 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="h-4 w-4" />
              {t('payments.loadError')}
            </p>
          ) : rows.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('payments.table.date')}</TableHead>
                    <TableHead>{t('payments.table.patient')}</TableHead>
                    <TableHead>{t('payments.table.method')}</TableHead>
                    <TableHead>{t('payments.table.reference')}</TableHead>
                    <TableHead className="text-right">{t('payments.table.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((payment) => (
                    <TableRow key={payment.id} data-testid="payment-row">
                      <TableCell>
                        {timeZone ? (
                          formatClinicDayTime(payment.receivedAt, timeZone, locale)
                        ) : (
                          <span className="text-muted-foreground">
                            {t('common.readingClinicClock')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/patients/$patientId"
                          params={{ patientId: payment.patientId }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {payment.patientName}
                        </Link>
                      </TableCell>
                      <TableCell>{paymentMethodLabel(t, payment.method)}</TableCell>
                      <TableCell>
                        {payment.reference ?? (
                          <span className="text-muted-foreground">{t('common.notProvided')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(payment.amountMinor, payment.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pagination && pagination.totalPages > 1 ? (
                <nav
                  aria-label={t('payments.pagination.aria')}
                  className="flex items-center justify-between"
                >
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('payments.pagination.previous')}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {t('payments.pagination.pageOf', {
                      page: pagination.page,
                      totalPages: pagination.totalPages,
                    })}
                  </p>
                  <Button
                    variant="outline"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('payments.pagination.next')}
                  </Button>
                </nav>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="payments-empty">
              {t('payments.empty')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
