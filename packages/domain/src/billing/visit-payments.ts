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
 * **What is settled has two doors, and they are the same rule read at two places.**
 * A charge that does not carry an `invoice_id` yet is settled against the bill the
 * settlement raises for it; a charge that already does is settled against the
 * document it was folded into. Either way the outstanding amount is summed in the
 * clinic's currency (the currency every charge on this visit was priced in), and a
 * payment may settle the whole of it or part of it.
 *
 * **A partial payment folds the bill; the remainder is then the document's own.**
 * Once a payment is in, *all* the un-invoiced charges are folded into the invoice
 * and stamped — there is no "billed later" after a bill was raised, and
 * `deriveInvoiceStatus` names the document the moment it is born. The part the
 * payment did not cover stays on it as `PARTIALLY_PAID`, and a later payment on the
 * same visit collects it there: the second door below reads this visit's open
 * documents and fills them oldest first, so open question 20's follow-up payment
 * lands on the ledger instead of beside it. What that door refuses is exactly what
 * the first one refuses — money this visit does not owe.
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
import type {
  InvoiceDetail,
  InvoiceRepository,
  PaymentRepository,
  UnitOfWork,
  VisitRepository,
} from '../ports/index.js';
import { getVisit } from '../visit/visit-read.js';
import {
  calculateChargeTotal,
  deriveInvoiceStatus,
  deriveInvoiceStatusFromTotals,
} from './invoice.js';
import type { Charge, Invoice, Payment, PaymentMethod } from './invoice.js';
import { sumMoney } from './money.js';
import { issueInvoice } from './visit-invoices.js';

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
  /** Strictly positive; never more than what the visit is still owed. */
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
 * Everything — the visit read, the clinic read, the outstanding sum, the writes —
 * runs inside one transaction, so a refusal or a failure leaves no half-written
 * settlement behind.
 *
 * The order is the contract: the visit first (a foreign visit is `NOT_FOUND`), the
 * clinic that owns the currency, the charges, whichever of the two doors those
 * charges leave open, then each field judged on its own, and only then the writes.
 * On the first door the invoice is born with the status `deriveInvoiceStatus` gives a
 * freshly-allocated document and the charges are stamped invoiced as the last
 * statement — so a settlement visible in the register can never name charges that
 * still read "not yet billed". On the second door the payment is split across the
 * visit's open documents and each one is moved to the status its new allocation
 * justifies, which is the whole effect a follow-up payment has on a document.
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

    // Which document the money is being collected against. Charges a bill has not
    // been raised for settle the bill as they are folded in; once every charge on
    // this visit carries a document, the documents themselves are what is left — so
    // the second read is skipped while there is still something to bill, because it
    // would answer a question the first door has already answered.
    const openInvoices =
      uninvoiced.length > 0
        ? []
        : await collectibleInvoices(clinicId, charges, repositories.invoices);

    if (uninvoiced.length === 0 && openInvoices.length === 0) {
      throw new DomainError('INVALID_INPUT', 'There is nothing left to pay on this visit', {
        visitId,
      });
    }

    // One figure from either door: what this visit is still owed, never what a
    // document elsewhere on the patient's ledger says. The two cannot disagree —
    // an allocation is written with its payment in the same transaction — but this
    // use case sums its own door rather than trusting the other to have been right.
    const outstandingMinor =
      uninvoiced.length > 0
        ? sumMoney(uninvoiced.map(calculateChargeTotal), clinic.currency).amountMinor
        : openInvoices.reduce((total, invoice) => total + invoice.balanceMinor, 0);

    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new DomainError('INVALID_INPUT', 'A payment must be a positive amount', {
        amountMinor: input.amountMinor,
      });
    }

    if (input.amountMinor > outstandingMinor) {
      throw new DomainError('INVALID_INPUT', 'A payment cannot exceed what this visit is owed', {
        amountMinor: input.amountMinor,
        outstandingMinor,
      });
    }

    const trimmedReference = input.reference?.trim();
    const reference = trimmedReference ? trimmedReference : null;

    if (reference && reference.length > 200) {
      throw new DomainError('INVALID_INPUT', 'The payment reference is too long', {
        reference,
      });
    }

    const receivedAt = dependencies.clock.now();

    const payment: Payment = {
      id: dependencies.newPaymentId(),
      clinicId,
      patientId: visit.patientId,
      method: input.method,
      currency: clinic.currency,
      amountMinor: input.amountMinor,
      reference,
      receivedAt,
    };

    if (uninvoiced.length > 0) {
      const invoiceId = dependencies.newInvoiceId();

      // The settlement issues the bill as it raises it: the document is born with the
      // status `deriveInvoiceStatus` gives a freshly-allocated invoice, never a `DRAFT`
      // it never spent a moment in. The draft below exists only to compute that status
      // — the number is the store's to assign (see `issueInvoice`).
      const draft: Invoice = {
        id: invoiceId,
        clinicId,
        patientId: visit.patientId,
        currency: clinic.currency,
        status: 'ISSUED',
        number: null,
        issuedAt: receivedAt,
        discountMinor: 0,
        taxRatePercent: 0,
        charges: uninvoiced,
      };

      await issueInvoice(repositories, {
        clinicId,
        patientId: visit.patientId,
        currency: clinic.currency,
        charges: uninvoiced,
        invoiceId,
        issuedAt: receivedAt,
        status: deriveInvoiceStatus(draft, input.amountMinor),
      });

      await repositories.payments.save(payment);

      await repositories.paymentAllocations.save({
        paymentId: payment.id,
        invoiceId,
        amountMinor: input.amountMinor,
      });

      return payment;
    }

    await repositories.payments.save(payment);

    // The second door: fill the visit's open documents oldest first, one allocation
    // per document, and say so on each one. Nothing is written to the charges or the
    // totals — the charges already name their document, and a total was written when
    // the document was raised and does not move.
    let remaining = input.amountMinor;

    for (const invoice of openInvoices) {
      if (remaining <= 0) {
        break;
      }

      const againstMinor = Math.min(remaining, invoice.balanceMinor);

      if (againstMinor <= 0) {
        continue;
      }

      await repositories.paymentAllocations.save({
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountMinor: againstMinor,
      });

      const status = deriveInvoiceStatusFromTotals(
        invoice.status,
        invoice.totalMinor,
        invoice.allocatedMinor + againstMinor,
      );

      if (status !== invoice.status) {
        await repositories.invoices.updateStatus(clinicId, invoice.id, status);
      }

      remaining -= againstMinor;
    }

    return payment;
  });
}

/**
 * This visit's documents that still take money, oldest first.
 *
 * The ids come from the charges themselves — a payment reaches a document only
 * through the charges that document folded in, so a bill this visit never raised
 * cannot be paid from here however much the patient owes on it. `[]` covers two
 * different states on purpose: a visit whose charges never reached a document (the
 * first door's business) and one whose documents have all been settled, because
 * `payVisitCharges` asks for this only when there is nothing left to bill and both
 * mean exactly the same refusal.
 *
 * Order decides which document a split payment fills first, never the total: the
 * charges' ids are sorted by when the document was created, then by id so two
 * documents written in the same instant still fill in a fixed order.
 */
async function collectibleInvoices(
  clinicId: ClinicId,
  charges: readonly Charge[],
  invoices: InvoiceRepository,
): Promise<readonly InvoiceDetail[]> {
  const invoiceIds = [
    ...new Set(charges.flatMap((charge) => (charge.invoiceId ? [charge.invoiceId] : []))),
  ];
  const held = await Promise.all(
    invoiceIds.map((invoiceId) => invoices.findById(clinicId, invoiceId)),
  );

  return held
    .filter(
      (invoice): invoice is InvoiceDetail =>
        invoice !== undefined &&
        invoice.status !== 'VOID' &&
        invoice.status !== 'DRAFT' &&
        invoice.balanceMinor > 0,
    )
    .sort(
      (left, right) =>
        (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}
