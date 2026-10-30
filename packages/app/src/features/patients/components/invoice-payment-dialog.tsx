import { useState } from 'react';
import type { InvoiceSummary, PaymentMethod } from '@denti-code-u3/domain';
import { formatMinorUnits } from '@denti-code-u3/domain';
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
import { paymentMethodOptions } from '../../payments/payment-method-presentation.js';
import { parseMajorUnitsToMinor } from '../../visits/charge-presentation.js';
import { describePaymentFailure } from '../../visits/describe-payment-failure.js';
import { usePayInvoice } from '../mutations/use-pay-invoice.js';

interface InvoicePaymentDialogProps {
  readonly invoice: InvoiceSummary;
  readonly patientId: string;
  readonly onClose: () => void;
}

export function InvoicePaymentDialog({ invoice, patientId, onClose }: InvoicePaymentDialogProps) {
  const { t } = useTranslation();
  const payInvoice = usePayInvoice();
  const [amountMajor, setAmountMajor] = useState(() => formatMinorUnits(invoice.balanceMinor));
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');

  const parsedAmount = parseMajorUnitsToMinor(amountMajor);
  const ready = method !== '' && parsedAmount !== undefined && parsedAmount > 0;
  const failure = describePaymentFailure(payInvoice.error, t('patients.invoices.paymentFailure'), {
    notFound: t('patients.invoices.paymentInvoiceNotFound'),
    network: t('patients.invoices.paymentNetwork'),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('patients.invoices.paymentTitle', { number: invoice.number ?? '—' })}
          </DialogTitle>
          <DialogDescription>
            {t('patients.invoices.paymentDescription', {
              amount: formatMinorUnits(invoice.balanceMinor),
              currency: invoice.currency,
            })}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || parsedAmount === undefined) {
              return;
            }
            payInvoice.mutate(
              {
                invoiceId: invoice.id,
                patientId,
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
              data-testid="invoice-payment-error"
              className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-payment-amount">{t('patients.invoices.paymentAmount')}</Label>
              <Input
                id="invoice-payment-amount"
                data-testid="invoice-payment-amount"
                value={amountMajor}
                onChange={(event) => setAmountMajor(event.target.value)}
                inputMode="decimal"
                disabled={payInvoice.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-payment-method">{t('patients.invoices.paymentMethod')}</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as PaymentMethod)}
                disabled={payInvoice.isPending}
              >
                <SelectTrigger id="invoice-payment-method" data-testid="invoice-payment-method">
                  <SelectValue placeholder={t('patients.invoices.paymentChooseMethod')} />
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
            <Label htmlFor="invoice-payment-reference">
              {t('patients.invoices.paymentReference')}
            </Label>
            <Input
              id="invoice-payment-reference"
              data-testid="invoice-payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              disabled={payInvoice.isPending}
              maxLength={200}
              placeholder={t('patients.invoices.paymentReferencePlaceholder')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={payInvoice.isPending}>
              {t('patients.invoices.paymentCancel')}
            </Button>
            <Button
              type="submit"
              disabled={!ready || payInvoice.isPending}
              data-testid="invoice-payment-submit"
            >
              {payInvoice.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('patients.invoices.paymentRecording')}
                </>
              ) : (
                t('patients.invoices.paymentRecord')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
