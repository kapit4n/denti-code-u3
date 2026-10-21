/**
 * Invoicing and patient balances.
 *
 * The distinction that matters clinically and financially:
 *
 * - `Charge`  — a priceable clinical event recorded during a visit.
 * - `Invoice` — a document grouping charges, issued to the patient.
 * - `Payment` — money received, allocated to one or more invoices.
 *
 * A charge may legitimately exist with no invoice (treatment done, billing
 * later), so `charge → invoice` is a nullable link rather than a mandatory one.
 */

import type {
  ChargeId,
  ClinicId,
  CurrencyCode,
  InvoiceId,
  IsoDateTime,
  PatientId,
  PaymentId,
  TreatmentId,
  VisitId,
} from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';
import { addMoney, money, percentageOf, subtractMoney, sumMoney } from './money.js';
import type { MoneyAmount } from './money.js';

/**
 * One priceable clinical event, as the `charges` row holds it.
 *
 * The entity is the whole row rather than the slice a screen happens to draw,
 * because the two build directions need the same columns: a write names the
 * clinic, the visit it belongs to and the currency it is priced in, and a read
 * reports the invoice the charge was folded into. A partial `Charge` shared
 * between the two would be the shape a future field has to break to add.
 */
export interface Charge {
  readonly id: ChargeId;
  readonly clinicId: ClinicId;
  readonly patientId: PatientId;
  /** Null for a charge raised outside a visit — the column is `on delete set null`. */
  readonly visitId: VisitId | null;
  /** Null until the charge is included in an invoice. */
  readonly invoiceId: InvoiceId | null;
  /** The instant the charge itself was invoiced, distinct from when it was created. */
  readonly invoicedAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  /** Null for a charge recorded by hand rather than from a treatment plan item. */
  readonly treatmentId: TreatmentId | null;
  /**
   * The planned line this charge bills, when it was raised from one.
   *
   * Null for a charge raised by hand. Provenance only: naming a plan item records
   * *which* planned line the money is for, and does not complete that line —
   * completion is `completeTreatmentPlanItem`'s own act, exactly as a recorded
   * treatment's link is.
   */
  readonly treatmentPlanItemId: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** Discount in minor units; never negative. */
  readonly discountMinor: number;
  readonly taxRatePercent: number;
  readonly currency: CurrencyCode;
}

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;

/**
 * How money reaches the clinic. Domain data: the receipt and the payment
 * register read from these values, so they cannot be invented by a screen.
 */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'YAPE', 'PLIN', 'OTHER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Invoice {
  readonly id: InvoiceId;
  readonly clinicId: ClinicId;
  readonly patientId: PatientId;
  readonly currency: CurrencyCode;
  readonly status: InvoiceStatus;
  /**
   * The human-facing document number, `F001-00001`, assigned by the repository
   * when the invoice is issued. Null on a document that has not been issued —
   * a `DRAFT` never printed, or a write model built before the number is read.
   */
  readonly number: string | null;
  /** The instant the document was issued; null until then, like `number`. */
  readonly issuedAt: IsoDateTime | null;
  readonly discountMinor: number;
  readonly taxRatePercent: number;
  readonly charges: readonly Charge[];
}

/**
 * Money received, as the `payments` row holds it.
 *
 * The full row rather than a slice, for the same reason `Charge` is the whole row:
 * a write names the clinic and the patient the money belongs to, and a read reports
 * the method and the reference, so a partial shape shared between the two would be
 * the form a future field has to break to add.
 *
 * `amountMinor` is strictly positive — the column's check enforces it, and a payment
 * of nothing is not money received.
 */
export interface Payment {
  readonly id: PaymentId;
  readonly clinicId: ClinicId;
  readonly patientId: PatientId;
  readonly method: PaymentMethod;
  readonly currency: CurrencyCode;
  readonly amountMinor: number;
  /** Optional free text, e.g. a card's last digits or a transfer's number. */
  readonly reference: string | null;
  readonly receivedAt: IsoDateTime;
}

/** One line of `invoice X was paid with payment Y, this much`. */
export interface PaymentAllocation {
  readonly paymentId: PaymentId;
  readonly invoiceId: InvoiceId;
  readonly amountMinor: number;
}

export interface InvoiceTotals {
  readonly subtotal: MoneyAmount;
  readonly discount: MoneyAmount;
  readonly tax: MoneyAmount;
  readonly total: MoneyAmount;
}

/** `quantity × unitPrice`, then the line discount, then tax. */
export function calculateChargeTotal(charge: Charge): MoneyAmount {
  if (!Number.isFinite(charge.quantity) || charge.quantity <= 0) {
    throw new DomainError('INVALID_INPUT', 'A charge quantity must be greater than zero', {
      chargeId: charge.id,
      quantity: charge.quantity,
    });
  }
  if (charge.discountMinor < 0) {
    throw new DomainError('INVALID_INPUT', 'A discount cannot be negative', {
      chargeId: charge.id,
      discountMinor: charge.discountMinor,
    });
  }

  const gross = money(Math.round(charge.quantity * charge.unitPriceMinor), charge.currency);
  const net = subtractMoney(gross, money(charge.discountMinor, charge.currency));
  return net.amountMinor <= 0 ? net : addMoney(net, percentageOf(net, charge.taxRatePercent));
}

/**
 * `total = subtotal - invoiceDiscount + tax`, where tax is charged on the
 * discounted subtotal.
 */
export function calculateInvoiceTotals(invoice: Invoice): InvoiceTotals {
  const zero = money(0, invoice.currency);
  const subtotal = sumMoney(
    invoice.charges.map((charge) =>
      money(Math.round(charge.quantity * charge.unitPriceMinor), charge.currency),
    ),
    invoice.currency,
  );
  const lineDiscounts = sumMoney(
    invoice.charges.map((charge) => money(charge.discountMinor, charge.currency)),
    invoice.currency,
  );

  const discount = addMoney(money(invoice.discountMinor, invoice.currency), lineDiscounts);
  const taxableBase = subtractMoney(subtotal, discount);
  const tax =
    taxableBase.amountMinor < 0 ? zero : percentageOf(taxableBase, invoice.taxRatePercent);

  return {
    subtotal,
    discount,
    tax,
    total: addMoney(taxableBase, tax),
  };
}

/**
 * One invoice's written-down figures, as the patient balance adds them up.
 *
 * The totals are the **document's own stored numbers**, never a recompute from its
 * charges. An invoice is a legal document and its printed total must not move when
 * a price is edited later, so the balance sums what was printed rather than
 * re-deriving it — the same line the invoice routes already hold. The read side's
 * `InvoiceSummary` satisfies this shape.
 */
export interface PatientInvoiceTotals {
  readonly id: InvoiceId;
  readonly status: InvoiceStatus;
  readonly totalMinor: number;
  readonly allocatedMinor: number;
}

/**
 * What a patient owes, as the ledger's one summary line.
 *
 * Five figures rather than one, because a clinic asking "what does this patient
 * owe" is asking three different questions that a single number hides: what has
 * been billed, how much of that has already been paid, and whether there is
 * credit sitting unallocated. A screen may draw only `balanceMinor`; a statement
 * needs all five, and they are derived once here so two screens cannot disagree.
 */
export interface PatientBalance {
  readonly currency: CurrencyCode;
  /** Issued documents' totals — what has been billed. Drafts and voids are not bills. */
  readonly billedMinor: number;
  /** Of that, how much payments have already been allocated to. */
  readonly allocatedMinor: number;
  /** `billed - allocated`: money still to collect on the documents themselves. */
  readonly outstandingMinor: number;
  /** Money received but not yet allocated to a document. */
  readonly unallocatedPaymentsMinor: number;
  /** `outstanding - unallocated`: what the patient still owes, credit included. */
  readonly balanceMinor: number;
}

/**
 * Sum a patient's invoices into what they owe.
 *
 * The authoritative balance rule (open question T6): **over invoice totals, not
 * over charges**, so the figure agrees with the document the patient was handed —
 * a tax-inclusive invoice and a charge-level balance would otherwise disagree, and
 * the printed page is what the clinic is held to.
 *
 * `DRAFT` and `VOID` are excluded: neither is a bill. A `DRAFT` has not been
 * issued and a `VOID` has been retired, and counting either would make the
 * patient's debt depend on a document the clinic would not show them. Only the
 * allocations on those counted documents are subtracted from the money received —
 * an allocation against a voided document leaves the money unallocated again.
 *
 * `receivedPaymentsMinor` is the raw total of the patient's payments, so the caller
 * need not pre-subtract anything. What is left after the live allocations is
 * `unallocatedPaymentsMinor`, and it is **signed rather than clamped**: money
 * received with nothing to allocate it against is a credit, and hiding it as zero
 * would keep a patient in credit from being told so.
 *
 * The balance collapses to `billed - received`, which is the point: how the money
 * was allocated is bookkeeping, and a payment must not change the answer by which
 * document it was pointed at.
 */
export function calculatePatientBalance(
  invoices: readonly PatientInvoiceTotals[],
  receivedPaymentsMinor: number,
  currency: CurrencyCode,
): PatientBalance {
  const billed = invoices.filter(
    (invoice) => invoice.status !== 'VOID' && invoice.status !== 'DRAFT',
  );

  const billedMinor = billed.reduce((total, invoice) => total + invoice.totalMinor, 0);
  const allocatedMinor = billed.reduce((total, invoice) => total + invoice.allocatedMinor, 0);
  const outstandingMinor = billedMinor - allocatedMinor;
  const unallocatedPaymentsMinor = receivedPaymentsMinor - allocatedMinor;

  return {
    currency,
    billedMinor,
    allocatedMinor,
    outstandingMinor,
    unallocatedPaymentsMinor,
    balanceMinor: outstandingMinor - unallocatedPaymentsMinor,
  };
}

/**
 * The status an invoice moves to once `allocatedMinor` sits against a total that is
 * already written down.
 *
 * The same rule `deriveInvoiceStatus` has always applied, but it takes the total as
 * a number instead of recomputing it from the charges — which is what an issuing
 * settlement has, and what reading an already-issued document answers with. Two
 * entry points, one rule: the recomputing form below only exists because a draft
 * being raised has no stored total yet.
 */
export function deriveInvoiceStatusFromTotals(
  status: InvoiceStatus,
  totalMinor: number,
  allocatedMinor: number,
): InvoiceStatus {
  if (status === 'VOID' || status === 'DRAFT' || status === 'PAID') {
    return status;
  }
  if (allocatedMinor <= 0) {
    return 'ISSUED';
  }
  return allocatedMinor >= totalMinor ? 'PAID' : 'PARTIALLY_PAID';
}

export function deriveInvoiceStatus(invoice: Invoice, allocatedMinor: number): InvoiceStatus {
  const { total } = calculateInvoiceTotals(invoice);
  return deriveInvoiceStatusFromTotals(invoice.status, total.amountMinor, allocatedMinor);
}
