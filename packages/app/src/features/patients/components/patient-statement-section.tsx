/**
 * The patient's statement — the ledger as a history, on demand.
 *
 * The Balance card answers "what is owed now"; this one answers "how did we get
 * here": every issued document and every payment, oldest first, with the balance
 * after each line. It is opened rather than always fetched, because a statement is
 * a report the desk asks for — and because a profile should not carry a second
 * billing read (and its failure state) for a section nobody opened.
 *
 * **Every figure is the server's.** The running balance and the closing figure are
 * computed by the domain over the documents' stored totals and the money received,
 * never re-added here from the rows; a screen that totalled its own page would be a
 * second, quieter answer to the same question.
 *
 * The days are the **clinic's** days, which is why the section takes the clinic's
 * zone — a payment at 23:00 in Lima belongs to that day, not to UTC's next one.
 */

import { useState } from 'react';
import { formatMinorUnits } from '@denti-code-u3/domain';
import { FileText } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@denti-code-u3/ui';

import { formatClinicDay } from '../../clinic/format-clinic-time.js';
import { useTranslation, type Translate } from '../../../i18n/index.js';
import { usePatientStatement } from '../hooks/use-patients.js';

interface PatientStatementSectionProps {
  readonly patientId: string;
  /** Absent while the clinic is still being fetched; the days then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

function describeLine(
  line: {
    readonly kind: 'INVOICE' | 'PAYMENT';
    readonly reference: string | null;
    readonly method: string | null;
  },
  t: Translate,
): string {
  if (line.kind === 'INVOICE') {
    return line.reference
      ? t('patients.statement.invoiceRef', { reference: line.reference })
      : t('patients.statement.invoice');
  }

  const method = line.method ?? t('patients.statement.paymentFallback');
  return line.reference
    ? t('patients.statement.paymentRef', { method, reference: line.reference })
    : t('patients.statement.payment', { method });
}

export function PatientStatementSection({
  patientId,
  clinicTimeZone,
}: PatientStatementSectionProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const statementQuery = usePatientStatement(patientId, isOpen);
  const statement = statementQuery.data;

  return (
    <Card data-testid="patient-statement">
      <CardHeader>
        <CardTitle>{t('patients.statement.title')}</CardTitle>
        <CardDescription>{t('patients.statement.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!isOpen ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('patients.statement.intro')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="open-statement"
              onClick={() => setIsOpen(true)}
            >
              <FileText aria-hidden className="mr-1 size-4" />
              {t('patients.statement.show')}
            </Button>
          </div>
        ) : statementQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t('patients.statement.loading')}</p>
        ) : statementQuery.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('patients.statement.loadError')}
          </p>
        ) : statement && statement.entries.length > 0 ? (
          <>
            <ul className="space-y-2">
              {statement.entries.map((line) => (
                <li
                  key={`${line.kind}-${line.id}`}
                  data-testid="statement-entry"
                  className="rounded-lg border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{describeLine(line, t)}</span>
                    <span className="tabular-nums" data-testid="statement-entry-amount">
                      {line.kind === 'INVOICE'
                        ? formatMinorUnits(line.debitMinor)
                        : `-${formatMinorUnits(line.creditMinor)}`}{' '}
                      {statement.currency}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {clinicTimeZone
                        ? formatClinicDay(line.occurredAt, clinicTimeZone)
                        : t('patients.profile.readingClock')}
                    </span>
                    <span className="tabular-nums" data-testid="statement-entry-balance">
                      {t('patients.statement.balance', {
                        amount: formatMinorUnits(line.balanceMinor),
                        currency: statement.currency,
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('patients.statement.billed')}</dt>
                <dd className="tabular-nums" data-testid="statement-billed">
                  {formatMinorUnits(statement.billedMinor)} {statement.currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('patients.statement.paid')}</dt>
                <dd className="tabular-nums" data-testid="statement-paid">
                  {formatMinorUnits(statement.paidMinor)} {statement.currency}
                </dd>
              </div>
              <div className="flex justify-between gap-4 font-medium">
                <dt>{t('patients.statement.closing')}</dt>
                <dd className="tabular-nums" data-testid="statement-closing">
                  {formatMinorUnits(statement.closingBalanceMinor)} {statement.currency}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('patients.statement.empty')}</p>
        )}
      </CardContent>
    </Card>
  );
}
