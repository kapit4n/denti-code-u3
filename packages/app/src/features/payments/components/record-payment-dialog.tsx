import { useMemo, useState } from 'react';
import { formatMinorUnits, type PaymentMethod } from '@denti-code-u3/domain';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denti-code-u3/ui';
import { AlertCircle, Loader2 } from 'lucide-react';

import { useTranslation } from '../../../i18n/index.js';
import { PatientPicker, type SelectedPatient } from '../../patients/components/patient-picker.js';
import {
  useInvoiceDetail,
  usePatientBalance,
  usePatientInvoices,
} from '../../patients/hooks/use-patients.js';
import { parseMajorUnitsToMinor } from '../../visits/charge-presentation.js';
import { describePaymentFailure } from '../../visits/describe-payment-failure.js';
import { usePayInvoice } from '../../patients/mutations/use-pay-invoice.js';
import { paymentMethodOptions } from '../payment-method-presentation.js';

interface RecordPaymentDialogProps {
  readonly onClose: () => void;
  /**
   * The patient the dialog was opened for. When set, the picker is omitted: the
   * profile already knows who is in front of the receptionist, and asking again
   * would be a chance to record the money against someone else.
   */
  readonly fixedPatient?: SelectedPatient;
}

export function RecordPaymentDialog({ onClose, fixedPatient }: RecordPaymentDialogProps) {
  const { t } = useTranslation();
  const payInvoice = usePayInvoice();
  const [pickedPatient, setPickedPatient] = useState<SelectedPatient | undefined>();
  const patient = fixedPatient ?? pickedPatient;
  const [invoiceId, setInvoiceId] = useState('');
  const [amountDraft, setAmountDraft] = useState<string | undefined>(undefined);
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');

  const invoicesQuery = usePatientInvoices(patient?.id ?? '');
  const balanceQuery = usePatientBalance(patient?.id ?? '');
  const openInvoices = useMemo(
    () =>
      (invoicesQuery.data?.items ?? []).filter(
        (invoice) =>
          invoice.status !== 'DRAFT' && invoice.status !== 'VOID' && invoice.balanceMinor > 0,
      ),
    [invoicesQuery.data],
  );
  const onlyInvoice = openInvoices.length === 1 ? openInvoices[0] : undefined;
  const selectedInvoiceId = invoiceId || onlyInvoice?.id || '';
  const invoice = openInvoices.find((candidate) => candidate.id === selectedInvoiceId);
  const invoiceDetailQuery = useInvoiceDetail(selectedInvoiceId);
  const amountMajor = amountDraft ?? (invoice ? formatMinorUnits(invoice.balanceMinor) : '');
  const balance = balanceQuery.data;
  /**
   * Nothing can be recorded until the patient has an invoice to apply money to.
   * Keep a disabled half-form off the screen in that case: the operator should
   * read why, not tab through controls that cannot become usable.
   */
  const invoicesUnavailable =
    patient !== undefined &&
    !invoicesQuery.isPending &&
    (invoicesQuery.error !== null || openInvoices.length === 0);

  const parsedAmount = parseMajorUnitsToMinor(amountMajor);
  const ready =
    patient !== undefined &&
    invoice !== undefined &&
    method !== '' &&
    parsedAmount !== undefined &&
    parsedAmount > 0;
  const failure = describePaymentFailure(payInvoice.error, t('payments.record.failure'), {
    notFound: t('payments.record.invoiceNotFound'),
    network: t('payments.record.network'),
  });

  function choosePatient(nextPatient: SelectedPatient | undefined) {
    setPickedPatient(nextPatient);
    setInvoiceId('');
    setAmountDraft(undefined);
    setMethod('');
    setReference('');
  }

  function chooseInvoice(nextInvoiceId: string) {
    const nextInvoice = openInvoices.find((candidate) => candidate.id === nextInvoiceId);
    setInvoiceId(nextInvoiceId);
    setAmountDraft(nextInvoice ? formatMinorUnits(nextInvoice.balanceMinor) : undefined);
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payments.record.title')}</DialogTitle>
          <DialogDescription>{t('payments.record.description')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !patient || !invoice || parsedAmount === undefined) {
              return;
            }
            payInvoice.mutate(
              {
                invoiceId: invoice.id,
                patientId: patient.id,
                method,
                amountMinor: parsedAmount,
                ...(reference.trim().length > 0 ? { reference: reference.trim() } : {}),
              },
              { onSuccess: onClose },
            );
          }}
        >
          {failure ? (
            <div
              role="alert"
              data-testid="payments-record-error"
              className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}

          {fixedPatient ? null : (
            <PatientPicker
              id="payments-record-patient"
              value={pickedPatient}
              onChange={choosePatient}
              disabled={payInvoice.isPending}
            />
          )}

          {patient ? (
            <div
              className="rounded-lg border bg-muted/40 p-3 text-sm"
              data-testid="payments-record-patient"
            >
              <p className="font-medium">{patient.label}</p>
              <p
                className="mt-1 text-muted-foreground"
                data-testid="payments-record-patient-balance"
              >
                {balanceQuery.isPending
                  ? t('payments.record.patientBalanceLoading')
                  : balanceQuery.error
                    ? t('payments.record.patientBalanceError')
                    : balance
                      ? balance.balanceMinor > 0
                        ? t('payments.record.patientOwes', {
                            amount: formatMinorUnits(balance.balanceMinor),
                            currency: balance.currency,
                          })
                        : balance.balanceMinor < 0
                          ? t('payments.record.patientCredit', {
                              amount: formatMinorUnits(Math.abs(balance.balanceMinor)),
                              currency: balance.currency,
                            })
                          : t('payments.record.patientSettled')
                      : null}
              </p>
            </div>
          ) : null}

          {invoicesUnavailable ? (
            <div
              role={invoicesQuery.error ? 'alert' : 'status'}
              data-testid="payments-record-no-invoices"
              className={`rounded-md border p-3 text-sm ${
                invoicesQuery.error
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'bg-muted/40 text-muted-foreground'
              }`}
            >
              <p className="font-medium">
                {invoicesQuery.error
                  ? t('payments.record.invoicesError')
                  : t('payments.record.noOpenInvoices')}
              </p>
              {invoicesQuery.error ? null : (
                <p className="mt-1 text-xs">{t('payments.record.noOpenInvoicesHint')}</p>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="payments-record-invoice">
                  {t('payments.record.invoice')}
                  <span aria-hidden> *</span>
                </Label>
                <Select
                  value={selectedInvoiceId}
                  onValueChange={chooseInvoice}
                  disabled={
                    patient === undefined ||
                    openInvoices.length === 0 ||
                    invoicesQuery.isPending ||
                    payInvoice.isPending
                  }
                >
                  <SelectTrigger id="payments-record-invoice" data-testid="payments-record-invoice">
                    <SelectValue placeholder={t('payments.record.chooseInvoice')} />
                  </SelectTrigger>
                  <SelectContent>
                    {openInvoices.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {t('payments.record.invoiceOption', {
                          number: candidate.number ?? '—',
                          amount: `${formatMinorUnits(candidate.balanceMinor)} ${candidate.currency}`,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {patient && invoicesQuery.isPending ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="payments-record-invoices-loading"
                  >
                    {t('payments.record.invoicesLoading')}
                  </p>
                ) : invoice ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="payments-record-outstanding"
                  >
                    {t('payments.record.outstanding', {
                      amount: `${formatMinorUnits(invoice.balanceMinor)} ${invoice.currency}`,
                    })}
                  </p>
                ) : null}
              </div>

              {invoice ? (
                <div className="space-y-2" data-testid="payments-record-treatments">
                  <p className="text-sm font-medium">{t('payments.record.treatments')}</p>
                  {invoiceDetailQuery.isPending ? (
                    <p className="text-xs text-muted-foreground">
                      {t('payments.record.treatmentsLoading')}
                    </p>
                  ) : invoiceDetailQuery.error ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t('payments.record.treatmentsError')}
                    </p>
                  ) : invoiceDetailQuery.data && invoiceDetailQuery.data.charges.length > 0 ? (
                    <ul className="space-y-1">
                      {invoiceDetailQuery.data.charges.map((charge) => (
                        <li
                          key={charge.id}
                          data-testid="payments-record-treatment"
                          className="flex items-baseline justify-between gap-3 rounded-md border px-3 py-2 text-xs"
                        >
                          <span className="min-w-0">
                            {charge.description}
                            {charge.quantity > 1
                              ? t('payments.record.treatmentQuantity', { count: charge.quantity })
                              : ''}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatMinorUnits(charge.unitPriceMinor)} {charge.currency}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('payments.record.treatmentsEmpty')}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="payments-record-amount">{t('payments.record.amount')}</Label>
                  <Input
                    id="payments-record-amount"
                    data-testid="payments-record-amount"
                    value={amountMajor}
                    onChange={(event) => setAmountDraft(event.target.value)}
                    inputMode="decimal"
                    disabled={invoice === undefined || payInvoice.isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payments-record-method">{t('payments.record.method')}</Label>
                  <Select
                    value={method}
                    onValueChange={(value) => setMethod(value as PaymentMethod)}
                    disabled={invoice === undefined || payInvoice.isPending}
                  >
                    <SelectTrigger id="payments-record-method" data-testid="payments-record-method">
                      <SelectValue placeholder={t('payments.record.chooseMethod')} />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentMethodOptions(t).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payments-record-reference">{t('payments.record.reference')}</Label>
                <Input
                  id="payments-record-reference"
                  data-testid="payments-record-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  disabled={invoice === undefined || payInvoice.isPending}
                  maxLength={200}
                  placeholder={t('payments.record.referencePlaceholder')}
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={payInvoice.isPending}>
              {t('payments.record.cancel')}
            </Button>
            {invoicesUnavailable ? null : (
              <Button
                type="submit"
                disabled={!ready || payInvoice.isPending}
                data-testid="payments-record-submit"
              >
                {payInvoice.isPending ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                    {t('payments.record.recording')}
                  </>
                ) : (
                  t('payments.record.submit')
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
