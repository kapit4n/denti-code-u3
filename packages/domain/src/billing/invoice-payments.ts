import type { ClinicId, InvoiceId, PaymentId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { UnitOfWork } from '../ports/index.js';
import { deriveInvoiceStatusFromTotals } from './invoice.js';
import type { Payment, PaymentMethod } from './invoice.js';

export interface PayInvoiceInput {
  readonly method: PaymentMethod;
  readonly amountMinor: number;
  readonly reference?: string;
}

export interface PayInvoiceDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly newPaymentId: () => PaymentId;
}

export async function payInvoice(
  clinicId: ClinicId,
  invoiceId: InvoiceId,
  input: PayInvoiceInput,
  dependencies: PayInvoiceDependencies,
): Promise<Payment> {
  return dependencies.unitOfWork.transaction(async (repositories) => {
    const invoice = await repositories.invoices.findById(clinicId, invoiceId);

    if (!invoice) {
      throw notFound('Invoice', invoiceId);
    }

    if (invoice.status === 'DRAFT' || invoice.status === 'VOID') {
      throw new DomainError('INVALID_INPUT', 'This invoice cannot take payments', {
        invoiceId,
        status: invoice.status,
      });
    }

    if (invoice.balanceMinor <= 0) {
      throw new DomainError('INVALID_INPUT', 'This invoice has nothing left to pay', {
        invoiceId,
      });
    }

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new DomainError('INVALID_INPUT', 'A payment must be a positive amount', {
        amountMinor: input.amountMinor,
      });
    }

    if (input.amountMinor > invoice.balanceMinor) {
      throw new DomainError('INVALID_INPUT', 'A payment cannot exceed the invoice balance', {
        amountMinor: input.amountMinor,
        balanceMinor: invoice.balanceMinor,
      });
    }

    const trimmedReference = input.reference?.trim();
    const reference = trimmedReference ? trimmedReference : null;

    if (reference && reference.length > 200) {
      throw new DomainError('INVALID_INPUT', 'The payment reference is too long', {
        reference,
      });
    }

    const payment: Payment = {
      id: dependencies.newPaymentId(),
      clinicId,
      patientId: invoice.patientId,
      method: input.method,
      currency: invoice.currency,
      amountMinor: input.amountMinor,
      reference,
      receivedAt: dependencies.clock.now(),
    };

    await repositories.payments.save(payment);

    await repositories.paymentAllocations.save({
      paymentId: payment.id,
      invoiceId,
      amountMinor: input.amountMinor,
    });

    const status = deriveInvoiceStatusFromTotals(
      invoice.status,
      invoice.totalMinor,
      invoice.allocatedMinor + input.amountMinor,
    );

    if (status !== invoice.status) {
      await repositories.invoices.updateStatus(clinicId, invoiceId, status);
    }

    return payment;
  });
}
