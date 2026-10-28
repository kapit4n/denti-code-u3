/**
 * What this patient owes the clinic — the ledger's summary line.
 *
 * Its own request and its own card, above the document list, because it answers the
 * question the list is opened to ask. Totaling the list here instead would be a
 * second, quieter answer to the same question: the figures come from the domain
 * across **every** document and every payment, including a payment that has not yet
 * reached one, and a section that only had the page it had fetched would miss both.
 *
 * **Every figure is the server's.** Five numbers, added once by the domain over the
 * documents' stored totals, never recomputed here from charges or from the list
 * below — a printed invoice and a screen that disagrees with it is the one way a
 * billing screen can lose a clinic's trust.
 *
 * The balance is drawn with its sign and its meaning, because three states look
 * identical in a column of digits: money owed, nothing owed, and money in credit.
 * A patient in credit is not a zero.
 */

import { formatMinorUnits } from '@denti-code-u3/domain';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { usePatientBalance } from '../hooks/use-patients.js';
import { useTranslation } from '../../../i18n/index.js';

interface PatientBalanceSectionProps {
  readonly patientId: string;
}

export function PatientBalanceSection({ patientId }: PatientBalanceSectionProps) {
  const { t } = useTranslation();
  const balanceQuery = usePatientBalance(patientId);
  const balance = balanceQuery.data;

  return (
    <Card data-testid="patient-balance">
      <CardHeader>
        <CardTitle>{t('patients.balance.title')}</CardTitle>
        <CardDescription>{t('patients.balance.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {balanceQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t('patients.balance.loading')}</p>
        ) : balanceQuery.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('patients.balance.loadError')}
          </p>
        ) : balance ? (
          <>
            <p
              data-testid="patient-balance-value"
              className={`text-2xl font-semibold tabular-nums ${
                balance.balanceMinor > 0
                  ? 'text-destructive'
                  : balance.balanceMinor < 0
                    ? 'text-primary'
                    : ''
              }`}
            >
              {formatMinorUnits(balance.balanceMinor)} {balance.currency}
            </p>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="patient-balance-state">
              {balance.balanceMinor > 0
                ? t('patients.balance.outstanding')
                : balance.balanceMinor < 0
                  ? t('patients.balance.credit')
                  : t('patients.balance.nothing')}
            </p>

            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('patients.balance.billed')}</dt>
                <dd className="tabular-nums" data-testid="patient-balance-billed">
                  {formatMinorUnits(balance.billedMinor)} {balance.currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('patients.balance.paid')}</dt>
                <dd className="tabular-nums" data-testid="patient-balance-allocated">
                  {formatMinorUnits(balance.allocatedMinor)} {balance.currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('patients.balance.stillToCollect')}</dt>
                <dd className="tabular-nums" data-testid="patient-balance-outstanding">
                  {formatMinorUnits(balance.outstandingMinor)} {balance.currency}
                </dd>
              </div>
              {/* Only a credit is worth a row: money received with nothing to spend it
                  on is the one figure in the five a settled ledger would hide. */}
              {balance.unallocatedPaymentsMinor !== 0 ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('patients.balance.unapplied')}</dt>
                  <dd className="tabular-nums" data-testid="patient-balance-unallocated">
                    {formatMinorUnits(balance.unallocatedPaymentsMinor)} {balance.currency}
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
