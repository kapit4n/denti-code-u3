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

import type { CurrencyCode } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';
import { addMoney, money, percentageOf, subtractMoney, sumMoney } from './money.js';
import type { MoneyAmount } from './money.js';

export interface Charge {
  readonly id: string;
  readonly patientId: string;
  readonly visitId?: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** Discount in minor units; never negative. */
  readonly discountMinor: number;
  readonly taxRatePercent: number;
  readonly currency: CurrencyCode;
  readonly invoicedAt?: string;
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
  readonly id: string;
  readonly patientId: string;
  readonly currency: CurrencyCode;
  readonly status: InvoiceStatus;
  readonly discountMinor: number;
  readonly taxRatePercent: number;
  readonly charges: readonly Charge[];
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

export interface Allocation {
  readonly invoiceId: string;
  readonly amountMinor: number;
}

export interface PatientBalance {
  readonly currency: CurrencyCode;
  /** Total of issued invoices that are not yet settled. */
  readonly outstandingMinor: number;
  /** Money received but not yet allocated to an invoice. */
  readonly unallocatedPaymentsMinor: number;
  /** `outstanding - unallocated`: what the patient still owes. */
  readonly balanceMinor: number;
}

export function calculatePatientBalance(
  invoices: readonly Invoice[],
  allocations: readonly Allocation[],
  unallocatedPaymentsMinor: number,
  currency: CurrencyCode,
): PatientBalance {
  const outstandingMinor = invoices
    .filter((invoice) => invoice.status !== 'VOID' && invoice.status !== 'DRAFT')
    .reduce((total, invoice) => total + calculateInvoiceTotals(invoice).total.amountMinor, 0);

  const allocatedMinor = allocations.reduce(
    (total, allocation) => total + allocation.amountMinor,
    0,
  );

  return {
    currency,
    outstandingMinor,
    unallocatedPaymentsMinor,
    balanceMinor: outstandingMinor - allocatedMinor - unallocatedPaymentsMinor,
  };
}

export function deriveInvoiceStatus(invoice: Invoice, allocatedMinor: number): InvoiceStatus {
  const { total } = calculateInvoiceTotals(invoice);
  if (invoice.status === 'VOID' || invoice.status === 'DRAFT') {
    return invoice.status;
  }
  if (invoice.status === 'PAID') {
    return 'PAID';
  }
  if (allocatedMinor <= 0) {
    return 'ISSUED';
  }
  return allocatedMinor >= total.amountMinor ? 'PAID' : 'PARTIALLY_PAID';
}
