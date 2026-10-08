import { describe, expect, it } from 'vitest';
import {
  calculateChargeTotal,
  calculateInvoiceTotals,
  calculatePatientBalance,
  deriveInvoiceStatus,
  type Charge,
  type Invoice,
} from './invoice.js';
import { addMoney, money, percentageOf, subtractMoney, sumMoney } from './money.js';
import { DomainError } from '../shared/errors.js';

function charge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: 'charge-1' as Charge['id'],
    clinicId: 'clinic-1' as Charge['clinicId'],
    patientId: 'patient-1' as Charge['patientId'],
    visitId: 'visit-1' as Charge['visitId'],
    invoiceId: null,
    invoicedAt: null,
    createdAt: '2026-10-05T14:00:00.000Z' as Charge['createdAt'],
    treatmentId: null,
    description: 'Composite restoration, tooth 16',
    quantity: 1,
    unitPriceMinor: 20_000,
    discountMinor: 0,
    taxRatePercent: 0,
    currency: 'USD',
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice-1',
    patientId: 'patient-1',
    currency: 'USD',
    status: 'ISSUED',
    discountMinor: 0,
    taxRatePercent: 0,
    charges: [charge()],
    ...overrides,
  };
}

describe('money arithmetic', () => {
  it('adds and subtracts exact integer amounts', () => {
    const ten = money(1000, 'USD');
    const three = money(350, 'USD');

    expect(addMoney(ten, three).amountMinor).toBe(1350);
    expect(subtractMoney(ten, three).amountMinor).toBe(650);
  });

  it('rejects a fractional amount', () => {
    expect(() => money(10.5, 'USD')).toThrow(DomainError);
  });

  it('refuses to combine two different currencies', () => {
    expect(() => addMoney(money(100, 'USD'), money(100, 'EUR'))).toThrow(DomainError);
  });

  it('rounds a percentage half-up to the nearest cent', () => {
    const base = money(333, 'USD');

    expect(percentageOf(base, 21).amountMinor).toBe(70);
    expect(percentageOf(base, 21).amountMinor).toBe(70);
    expect(percentageOf(money(1000, 'USD'), 21).amountMinor).toBe(210);
  });

  it('sums an empty list to zero', () => {
    expect(sumMoney([], 'USD').amountMinor).toBe(0);
  });
});

describe('calculateChargeTotal', () => {
  it('multiplies quantity by unit price', () => {
    const total = calculateChargeTotal(charge({ quantity: 3, unitPriceMinor: 5_000 }));

    expect(total.amountMinor).toBe(15_000);
  });

  it('applies the line discount before tax', () => {
    const total = calculateChargeTotal(
      charge({ unitPriceMinor: 20_000, discountMinor: 2_000, taxRatePercent: 21 }),
    );

    // 20.000 - 2.000 = 18.000, +21% = 3.780 → 21.780
    expect(total.amountMinor).toBe(21_780);
  });

  it('rejects a non-positive quantity', () => {
    expect(() => calculateChargeTotal(charge({ quantity: 0 }))).toThrow(DomainError);
    expect(() => calculateChargeTotal(charge({ quantity: -1 }))).toThrow(DomainError);
  });

  it('rejects a negative discount', () => {
    expect(() => calculateChargeTotal(charge({ discountMinor: -100 }))).toThrow(DomainError);
  });
});

describe('calculateInvoiceTotals', () => {
  it('computes subtotal, tax and total for a single charge', () => {
    const totals = calculateInvoiceTotals(invoice({ taxRatePercent: 21 }));

    expect(totals.subtotal.amountMinor).toBe(20_000);
    expect(totals.tax.amountMinor).toBe(4_200);
    expect(totals.total.amountMinor).toBe(24_200);
  });

  it('applies the invoice discount before tax', () => {
    const totals = calculateInvoiceTotals(invoice({ discountMinor: 5_000, taxRatePercent: 21 }));

    expect(totals.discount.amountMinor).toBe(5_000);
    expect(totals.tax.amountMinor).toBe(3_150);
    expect(totals.total.amountMinor).toBe(18_150);
  });

  it('sums the line discounts together with the invoice discount', () => {
    const totals = calculateInvoiceTotals(
      invoice({
        charges: [
          charge(),
          charge({ id: 'charge-2' as Charge['id'], unitPriceMinor: 10_000, discountMinor: 1_000 }),
        ],
      }),
    );

    expect(totals.subtotal.amountMinor).toBe(30_000);
    expect(totals.discount.amountMinor).toBe(1_000);
    expect(totals.total.amountMinor).toBe(29_000);
  });

  it('never produces a negative total when discounts exceed the subtotal', () => {
    const totals = calculateInvoiceTotals(invoice({ discountMinor: 99_000 }));

    expect(totals.total.amountMinor).toBeLessThanOrEqual(0);
    expect(totals.tax.amountMinor).toBe(0);
  });
});

describe('deriveInvoiceStatus', () => {
  it('reports a fully paid invoice as paid', () => {
    const subject = invoice();

    expect(deriveInvoiceStatus(subject, 20_000)).toBe('PAID');
  });

  it('reports a partially paid invoice as partially paid', () => {
    const subject = invoice();

    expect(deriveInvoiceStatus(subject, 5_000)).toBe('PARTIALLY_PAID');
  });

  it('reports an unpaid issued invoice as issued', () => {
    const subject = invoice();

    expect(deriveInvoiceStatus(subject, 0)).toBe('ISSUED');
  });

  it('leaves a draft invoice as a draft', () => {
    const subject = { ...invoice(), status: 'DRAFT' as const };

    expect(deriveInvoiceStatus(subject, 0)).toBe('DRAFT');
  });
});

describe('calculatePatientBalance', () => {
  it('reports what the patient still owes', () => {
    const balance = calculatePatientBalance(
      [invoice({ charges: [charge({ unitPriceMinor: 30_000 })] })],
      [{ invoiceId: 'invoice-1', amountMinor: 10_000 }],
      0,
      'USD',
    );

    expect(balance.outstandingMinor).toBe(30_000);
    expect(balance.balanceMinor).toBe(20_000);
  });

  it('counts unallocated payments against the balance', () => {
    const balance = calculatePatientBalance(
      [invoice()],
      [{ invoiceId: 'invoice-1', amountMinor: 20_000 }],
      5_000,
      'USD',
    );

    expect(balance.outstandingMinor).toBe(20_000);
    expect(balance.unallocatedPaymentsMinor).toBe(5_000);
    expect(balance.balanceMinor).toBe(-5_000);
  });

  it('ignores draft and void invoices', () => {
    const balance = calculatePatientBalance(
      [
        { ...invoice(), status: 'DRAFT' },
        { ...invoice(), id: 'invoice-2', status: 'VOID' },
      ],
      [],
      0,
      'USD',
    );

    expect(balance.outstandingMinor).toBe(0);
  });
});
