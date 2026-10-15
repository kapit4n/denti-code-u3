/**
 * The patient's invoices: the documents the clinic has issued, and what is owed.
 *
 * Read-only, and its own request — the same ownership the plans and odontogram
 * sections have. Milestone 9's first slice raises a document and reads it back;
 * collecting the rest of one, issuing an installment or drawing a statement is the
 * ledger's next slice, so this card draws no control that would pretend to know a
 * rule the API does not have yet.
 *
 * **Every figure is the server's.** `totalMinor` and `balanceMinor` are the
 * document's stored numbers and the store's own arithmetic over its allocations,
 * never a sum this component does. A `null` number is drawn as an em dash rather
 * than invented: a document raised before numbering existed, or a draft, has no
 * number to quote. The issued day is the **clinic's** day, which is why the
 * section asks for the clinic's zone — the same reason the profile's cards do.
 */

import { formatMinorUnits } from '@denti-code-u3/domain';
import { ReceiptText } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { formatClinicDay, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { usePatientInvoices } from '../hooks/use-patients.js';

interface PatientInvoicesSectionProps {
  readonly patientId: string;
  /** Absent while the clinic is still being fetched; the days then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

export function PatientInvoicesSection({ patientId, clinicTimeZone }: PatientInvoicesSectionProps) {
  const invoicesQuery = usePatientInvoices(patientId);

  const invoices = invoicesQuery.data?.items ?? [];

  return (
    <Card data-testid="patient-invoices">
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>The documents issued for this patient</CardDescription>
      </CardHeader>
      <CardContent>
        {invoicesQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the invoices…</p>
        ) : invoicesQuery.error ? (
          <p role="alert" className="text-sm text-destructive">
            The invoices could not be loaded.
          </p>
        ) : invoices.length > 0 ? (
          <ul className="space-y-3">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                data-testid="patient-invoice"
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {invoice.number ?? '—'}
                    <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {invoice.status.replaceAll('_', ' ')}
                    </span>
                  </span>
                  <span className="text-muted-foreground" data-testid="invoice-total">
                    {formatMinorUnits(invoice.totalMinor)} {invoice.currency}
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {invoice.chargeCount} charge{invoice.chargeCount === 1 ? '' : 's'}
                  {invoice.issuedAt
                    ? clinicTimeZone
                      ? ` · issued ${formatClinicDay(invoice.issuedAt, clinicTimeZone)}`
                      : ` · ${READING_THE_CLINIC_CLOCK}`
                    : ''}
                </p>

                {invoice.balanceMinor > 0 ? (
                  <p className="mt-1 text-xs" data-testid="invoice-balance">
                    {formatMinorUnits(invoice.balanceMinor)} {invoice.currency} outstanding
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="invoice-balance">
                    Paid in full
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ReceiptText aria-hidden className="size-4" />
            No invoices for this patient yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
