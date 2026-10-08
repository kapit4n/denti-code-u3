/**
 * Settling a visit's bill — the workspace's "Payments" section, and the first
 * write here that happens inside a `UnitOfWork` since starting a visit.
 *
 * **Why the transaction is the whole use case, not a read-then-write pair.** A
 * payment writes four rows — the invoice, the payment, its allocation, and the
 * `invoiced_at` stamps on the charges it folds in. A crash between any of them
 * would leave an invoice with charges still "not yet billed", or money received
 * with nothing allocating it, and half of that would look normal (ADR 0021). This
 * is the first use case whose read also lives inside the transaction: the visit
 * and the clinic are resolved there, so no statement can run outside the atomic
 * section that decides it.
 *
 * **What is settled is the *un-invoiced* bill.** The visit's charges that already
 * carry an `invoice_id` are another document's business — editing or re-opening an
 * issued invoice is Milestone 9, and a balance ledger does not exist until then.
 * The outstanding amount is the sum of the un-invoiced charges' own totals, in the
 * clinic's currency (the currency every charge on this visit was priced in). A
 * payment may settle the whole of it or part of it; `deriveInvoiceStatus` decides
 * what the invoice is called the moment it is born, exactly as it will for the
 * ledger that reads these rows later.
 *
 * **The boundary a partial payment draws is deliberate, and it has an OPEN
 * QUESTION beside it.** Once a payment is in, *all* the un-invoiced charges are
 * folded into the invoice and stamped — there is no "billed later" after a bill
 * was raised. A later payment on the same visit then finds nothing left to pay
 * until Milestone 9 reads the invoice's remaining balance. That is a fixed
 * boundary, not a bug to paper over: collecting the rest of an issued invoice is
 * the ledger's job, and pretending otherwise here would hide it under a second
 * path that reads the same rows. Recorded in `docs/open-questions.md` with the
 * billing rows, so the boundary is not mistaken for a defect.
 *
 * **Who and what the rows name is inherited or owned, never restated.** The
 * patient, the clinic and the currency come from the visit and the clinic; the
 * request names only the method, the amount and an optional reference. `receivedAt`
 * is the clock's, and the two ids come from the caller's generators — the same
 * division of labour every write here keeps.
 */

import type { ClinicId, InvoiceId, PaymentId, VisitId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { PaymentRepository, UnitOfWork, VisitRepository } from '../ports/index.js';
import { getVisit } from '../visit/visit-read.js';
import {
  calculateChargeTotal,
  deriveInvoiceStatus,
  type Invoice,
  type Payment,
  type PaymentMethod,
} from './invoice.js';
import { sumMoney } from './money.js';

/** The as-yet-unbilled bill a visit has grown, read without writing anything. */
export interface VisitPaymentsReadDependencies {
  readonly visits: VisitRepository;
  readonly payments: PaymentRepository;
}

/**
 * Every payment on this visit's invoice, in the order the register reads them.
 *
 * 404 for a visit this clinic does not hold, and `[]` only for a visit that does —
 * the same subject-shaped read as the charges: a foreign visit's payments are not
 * this clinic's to list (ADR 0014).
 */
export async function listVisitPayments(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: VisitPaymentsReadDependencies,
): Promise<readonly Payment[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.payments.findForVisit(clinicId, visitId);
}

/** The body a caller hands to the settlement use case, in domain terms. */
export interface NewPaymentInput {
  readonly method: PaymentMethod;
  /** Strictly positive; never more than the visit's un-invoiced total. */
  readonly amountMinor: number;
  /** Optional free text, e.g. a card's last digits. Blank is dropped to null. */
  readonly reference?: string;
}

export interface PayVisitChargesDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly newInvoiceId: () => InvoiceId;
  readonly newPaymentId: () => PaymentId;
}

/**
 * Record a payment against a visit this clinic holds, and stamp the bill it settles.
 *
 * Everything — the visit read, the clinic read, the outstanding sum, the four
 * writes — runs inside one transaction, so a refusal or a failure leaves no
 * half-written settlement behind.
 *
 * The order is the contract: the visit first (a foreign visit is `NOT_FOUND`), the
 * clinic that owns the currency, the un-invoiced charges, then each field judged on
 * its own, and only then the writes. The invoice is born with the status
 * `deriveInvoiceStatus` gives a freshly-allocated document, the payment carries
 * `receivedAt` from the clock, the allocation names what the invoice was paid with,
 * and the charges are stamped invoiced as the last statement — so a settlement
 * visible in the register can never name charges that still read "not yet billed".
 */
export async function payVisitCharges(
  clinicId: ClinicId,
  visitId: VisitId,
  input: NewPaymentInput,
  dependencies: PayVisitChargesDependencies,
): Promise<Payment> {
  return dependencies.unitOfWork.transaction(async (repositories) => {
    const visit = await repositories.visits.findById(clinicId, visitId);

    if (!visit) {
      throw notFound('Visit', visitId);
    }

    const clinic = await repositories.clinics.findById(clinicId);

    // The visit proved the clinic exists a statement ago, so this is a defence, not
    // a path a caller can reach twice — but a clinic deleted between the two reads
    // would otherwise price a settlement in a currency that no longer means
    // anything here.
    if (!clinic) {
      throw notFound('Clinic', clinicId);
    }

    const charges = await repositories.charges.findForVisit(clinicId, visitId);
    const uninvoiced = charges.filter((charge) => charge.invoiceId === null);

    if (uninvoiced.length === 0) {
      throw new DomainError('INVALID_INPUT', 'There is nothing left to pay on this visit', {
        visitId,
      });
    }

    const outstanding = sumMoney(uninvoiced.map(calculateChargeTotal), clinic.currency);

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new DomainError('INVALID_INPUT', 'A payment must be a positive amount', {
        amountMinor: input.amountMinor,
      });
    }

    if (input.amountMinor > outstanding.amountMinor) {
      throw new DomainError('INVALID_INPUT', 'A payment cannot exceed what this visit is owed', {
        amountMinor: input.amountMinor,
        outstandingMinor: outstanding.amountMinor,
      });
    }

    const trimmedReference = input.reference?.trim();
    const reference = trimmedReference ? trimmedReference : null;

    if (reference && reference.length > 200) {
      throw new DomainError('INVALID_INPUT', 'The payment reference is too long', {
        reference,
      });
    }

    const invoiceId = dependencies.newInvoiceId();
    const invoice: Invoice = {
      id: invoiceId,
      clinicId,
      patientId: visit.patientId,
      currency: clinic.currency,
      // A settlement issues the bill as it raises it: the moment the invoice is
      // born it has already been allocated to, so its status is decided by how much
      // it was allocated, never by a DRAFT it never spent a moment in.
      status: 'ISSUED',
      discountMinor: 0,
      taxRatePercent: 0,
      charges: uninvoiced,
    };

    await repositories.invoices.save({
      ...invoice,
      status: deriveInvoiceStatus(invoice, input.amountMinor),
    });

    const payment: Payment = {
      id: dependencies.newPaymentId(),
      clinicId,
      patientId: visit.patientId,
      method: input.method,
      currency: clinic.currency,
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

    await repositories.charges.markInvoiced(
      clinicId,
      uninvoiced.map((charge) => charge.id),
      invoiceId,
      dependencies.clock.now(),
    );

    return payment;
  });
}
