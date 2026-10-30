import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asInvoiceId,
  asPatientId,
  asPaymentId,
  type ClinicId,
  type InvoiceId,
  type IsoDateTime,
  type PaymentId,
} from '@denti-code-u3/types';
import type {
  InvoiceDetail,
  InvoiceRepository,
  PaymentAllocationRepository,
  PaymentRepository,
  Repositories,
  UnitOfWork,
} from '../ports/index.js';
import type { InvoiceStatus, Payment, PaymentAllocation } from './invoice.js';
import { payInvoice } from './invoice-payments.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const INVOICE = asInvoiceId('88888888-8888-4888-8888-888888888888');
const PAYMENT = asPaymentId('99999999-9999-4999-8999-999999999999');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function aDocument(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: INVOICE,
    patientId: asPatientId('11111111-1111-4111-8111-111111111111'),
    number: 'F001-00001',
    status: 'ISSUED',
    currency: 'PEN',
    subtotalMinor: 10_000,
    discountMinor: 0,
    taxRatePercent: 0,
    totalMinor: 10_000,
    allocatedMinor: 0,
    balanceMinor: 10_000,
    chargeCount: 1,
    issuedAt: NOW,
    createdAt: NOW,
    charges: [],
    ...overrides,
  };
}

interface Recorded {
  payments: Payment[];
  allocations: PaymentAllocation[];
  statusUpdates: { clinicId: ClinicId; invoiceId: InvoiceId; status: InvoiceStatus }[];
  transactions: number;
}

function harness(options: { invoice?: InvoiceDetail | null; paymentId?: PaymentId } = {}) {
  const recorded: Recorded = {
    payments: [],
    allocations: [],
    statusUpdates: [],
    transactions: 0,
  };

  const invoices = {
    async findById() {
      return options.invoice === null ? undefined : (options.invoice ?? aDocument());
    },
    async updateStatus(clinicId: ClinicId, invoiceId: InvoiceId, status: InvoiceStatus) {
      recorded.statusUpdates.push({ clinicId, invoiceId, status });
    },
  } as unknown as InvoiceRepository;

  const payments = {
    async save(payment: Payment) {
      recorded.payments.push(payment);
    },
  } as unknown as PaymentRepository;

  const paymentAllocations = {
    async save(allocation: PaymentAllocation) {
      recorded.allocations.push(allocation);
    },
  } as unknown as PaymentAllocationRepository;

  const repositories = { invoices, payments, paymentAllocations } as unknown as Repositories;

  const unitOfWork: UnitOfWork = {
    async transaction(work) {
      recorded.transactions += 1;
      return work(repositories);
    },
  };

  return {
    recorded,
    pay: (input: Parameters<typeof payInvoice>[2]) =>
      payInvoice(CLINIC, INVOICE, input, {
        unitOfWork,
        clock: { now: () => NOW },
        newPaymentId: () => options.paymentId ?? PAYMENT,
      }),
  };
}

describe('payInvoice', () => {
  it('records the payment, allocates it, and moves the invoice to paid', async () => {
    const { recorded, pay } = harness();

    const payment = await pay({
      method: 'CARD',
      amountMinor: 10_000,
      reference: '  **** 4242  ',
    });

    expect(recorded.transactions).toBe(1);
    expect(payment).toEqual({
      id: PAYMENT,
      clinicId: CLINIC,
      patientId: asPatientId('11111111-1111-4111-8111-111111111111'),
      method: 'CARD',
      currency: 'PEN',
      amountMinor: 10_000,
      reference: '**** 4242',
      receivedAt: NOW,
    });
    expect(recorded.payments).toEqual([payment]);
    expect(recorded.allocations).toEqual([
      { paymentId: PAYMENT, invoiceId: INVOICE, amountMinor: 10_000 },
    ]);
    expect(recorded.statusUpdates).toEqual([
      { clinicId: CLINIC, invoiceId: INVOICE, status: 'PAID' },
    ]);
  });

  it('marks a partial payment and keeps the invoice open', async () => {
    const { recorded, pay } = harness({ invoice: aDocument({ balanceMinor: 10_000 }) });

    await pay({ method: 'CASH', amountMinor: 4_000 });

    expect(recorded.payments[0]?.reference).toBeNull();
    expect(recorded.statusUpdates).toEqual([
      { clinicId: CLINIC, invoiceId: INVOICE, status: 'PARTIALLY_PAID' },
    ]);
  });

  it('adds to an existing allocation before deciding the status', async () => {
    const { recorded, pay } = harness({
      invoice: aDocument({ status: 'PARTIALLY_PAID', allocatedMinor: 4_000, balanceMinor: 6_000 }),
    });

    await pay({ method: 'CASH', amountMinor: 6_000 });

    expect(recorded.statusUpdates[0]?.status).toBe('PAID');
  });

  it('refuses an invoice this clinic does not hold', async () => {
    const { recorded, pay } = harness({ invoice: null });

    await expect(pay({ method: 'CASH', amountMinor: 100 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.payments).toHaveLength(0);
  });

  it.each(['DRAFT', 'VOID'] as const)(
    'never treats an invoice in %s as payable',
    async (status) => {
      const { recorded, pay } = harness({
        invoice: aDocument({ status, balanceMinor: 10_000 }),
      });

      await expect(pay({ method: 'CASH', amountMinor: 100 })).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
      expect(recorded.payments).toHaveLength(0);
    },
  );

  it('refuses a fully paid invoice', async () => {
    const { recorded, pay } = harness({
      invoice: aDocument({ status: 'PAID', allocatedMinor: 10_000, balanceMinor: 0 }),
    });

    await expect(pay({ method: 'CASH', amountMinor: 100 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(recorded.payments).toHaveLength(0);
  });

  it.each([0, -1, 1.5])(
    'refuses an amount that is not a positive integer: %s',
    async (amountMinor) => {
      const { recorded, pay } = harness();

      await expect(pay({ method: 'CASH', amountMinor })).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
      expect(recorded.payments).toHaveLength(0);
    },
  );

  it('refuses more than the invoice balance', async () => {
    const { recorded, pay } = harness();

    await expect(pay({ method: 'CASH', amountMinor: 10_001 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(recorded.payments).toHaveLength(0);
  });

  it('refuses an over-long reference', async () => {
    const { recorded, pay } = harness();

    await expect(
      pay({ method: 'CASH', amountMinor: 100, reference: 'x'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.payments).toHaveLength(0);
  });
});
