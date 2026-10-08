/**
 * `payVisitCharges` and `listVisitPayments` — settling a visit's bill.
 *
 * What is worth testing is the decisions the file makes, which would otherwise be
 * discovered as bugs:
 *
 *  - **The whole settlement is one transaction.** The visit, the clinic, the
 *    charges and every write run inside the `UnitOfWork`, and a refusal throws
 *    from inside it — nothing in the record can show a settlement only half made
 *    (ADR 0021).
 *  - **Who and what the rows name is inherited or owned, never restated.**
 *    `clinicId`, `patientId` and `currency` come from the visit and the clinic;
 *    the request names only the method, the amount and an optional reference.
 *  - **The billing rules live here, not in the schema.** A payment must be a
 *    positive integer no larger than what the visit's un-invoiced charges are
 *    worth, and a visit with nothing left un-invoiced cannot be paid again.
 *  - **The invoice's status is decided, not assumed.** A full settlement is born
 *    `PAID` and a partial one `PARTIALLY_PAID`, through the same
 *    `deriveInvoiceStatus` the future ledger reads.
 *
 * The clock, the id generators and the writes are asserted rather than trusted,
 * for the same reason `visit-charges.test.ts` asserts them: an entity stamped or
 * numbered by a dependency is an entity the use case cannot testify about.
 */

import { describe, expect, it } from 'vitest';

import {
  asChargeId,
  asClinicId,
  asInvoiceId,
  asPatientId,
  asPaymentId,
  asVisitId,
  type ChargeId,
  type ClinicId,
  type InvoiceId,
  type IsoDateTime,
  type PaymentId,
  type VisitId,
} from '@denti-code-u3/types';
import type {
  ChargeRepository,
  ClinicRepository,
  InvoiceRepository,
  PaymentAllocationRepository,
  PaymentRepository,
  Repositories,
  UnitOfWork,
  VisitRepository,
} from '../ports/index.js';
import type { Clinic } from '../organization/index.js';
import type { Visit } from '../visit/index.js';
import type { Charge, Invoice, Payment, PaymentAllocation } from './invoice.js';
import { listVisitPayments, payVisitCharges } from './visit-payments.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const CHARGE = asChargeId('77777777-7777-4777-8777-777777777777');
const INVOICE = asInvoiceId('88888888-8888-4888-8888-888888888888');
const PAYMENT = asPaymentId('99999999-9999-4999-8999-999999999999');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;

function openVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: null,
    startedAt: '2026-10-05T14:00:00.000Z' as IsoDateTime,
    status: 'OPEN',
    ...overrides,
  };
}

function aClinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    id: CLINIC,
    name: 'Clinica Visible',
    timeZone: 'America/Lima',
    currency: 'PEN',
    operatingHours: [],
    settings: {},
    ...overrides,
  };
}

function aCharge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: CHARGE,
    clinicId: CLINIC,
    patientId: PATIENT,
    visitId: VISIT,
    treatmentId: null,
    description: 'Composite restoration, tooth 16',
    quantity: 1,
    unitPriceMinor: 20_000,
    discountMinor: 0,
    taxRatePercent: 0,
    currency: 'PEN',
    invoiceId: null,
    invoicedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

interface Recorded {
  invoices: Invoice[];
  payments: Payment[];
  allocations: PaymentAllocation[];
  markedInvoiced: {
    clinicId: ClinicId;
    chargeIds: readonly ChargeId[];
    invoiceId: InvoiceId;
    invoicedAt: string;
  }[];
  visitsRead: { clinicId: ClinicId; visitId: VisitId }[];
  paymentsRead: { clinicId: ClinicId; visitId: VisitId }[];
}

function harness(
  options: {
    visit?: Visit;
    clinic?: Clinic;
    /** The charges `findForVisit` answers with; uninvoiced by default. */
    storedCharges?: readonly Charge[];
    /** The payments `findForVisit` answers with on the read side. */
    storedPayments?: readonly Payment[];
  } = {},
) {
  const recorded: Recorded = {
    invoices: [],
    payments: [],
    allocations: [],
    markedInvoiced: [],
    visitsRead: [],
    paymentsRead: [],
  };

  const storedVisit: Visit | undefined = 'visit' in options ? options.visit : openVisit();
  const storedClinic: Clinic | undefined = 'clinic' in options ? options.clinic : aClinic();

  const visits: VisitRepository = {
    findById: async (clinicId, visitId) =>
      storedVisit && storedVisit.id === visitId && storedVisit.clinicId === clinicId
        ? storedVisit
        : undefined,
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    updateStatus: async () => {},
    save: async () => {},
  };

  const clinics: ClinicRepository = {
    findById: async (clinicId) =>
      storedClinic && storedClinic.id === clinicId ? storedClinic : undefined,
    getDefault: async () => storedClinic,
  };

  const charges: ChargeRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.visitsRead.push({ clinicId, visitId });
      return options.storedCharges ?? [];
    },
    save: async () => {},
    markInvoiced: async (clinicId, chargeIds, invoiceId, invoicedAt) => {
      recorded.markedInvoiced.push({ clinicId, chargeIds, invoiceId, invoicedAt });
    },
  };

  const invoices: InvoiceRepository = {
    save: async (invoice) => {
      recorded.invoices.push(invoice);
    },
  };

  const payments: PaymentRepository = {
    findForVisit: async (clinicId, visitId) => {
      recorded.paymentsRead.push({ clinicId, visitId });
      return options.storedPayments ?? [];
    },
    save: async (payment) => {
      recorded.payments.push(payment);
    },
  };

  const paymentAllocations: PaymentAllocationRepository = {
    save: async (allocation) => {
      recorded.allocations.push(allocation);
    },
  };

  // The use case only ever sees the set through a transaction, so the harness fakes
  // the transaction itself and hands it the subset the settlement touches. The cast
  // is the seam the ports exist to keep narrow: the fakes above are the shape of
  // the fourteen implementations, and the rest of the set is not what this file is
  // about.
  const unitOfWork: UnitOfWork = {
    transaction: async (work) =>
      work({
        visits,
        clinics,
        charges,
        invoices,
        payments,
        paymentAllocations,
      } as unknown as Repositories),
  };

  return {
    recorded,
    dependencies: {
      unitOfWork,
      clock: { now: () => NOW },
      newInvoiceId: () => INVOICE,
      newPaymentId: () => PAYMENT,
    },
    readDependencies: { visits, payments },
  };
}

describe('payVisitCharges', () => {
  const due = aCharge({ unitPriceMinor: 8_500 });

  it('settles the whole bill and marks it invoiced, in one transaction', async () => {
    const { recorded, dependencies } = harness({ storedCharges: [due] });

    const payment = await payVisitCharges(
      CLINIC,
      VISIT,
      { method: 'CARD', amountMinor: 8_500, reference: '  *** 4242  ' },
      dependencies,
    );

    // A full settlement is born PAID: the invoice never spent a moment in DRAFT.
    expect(recorded.invoices).toEqual([
      {
        id: INVOICE,
        clinicId: CLINIC,
        patientId: PATIENT,
        currency: 'PEN',
        status: 'PAID',
        discountMinor: 0,
        taxRatePercent: 0,
        charges: [due],
      },
    ]);

    expect(recorded.payments).toEqual([
      {
        id: PAYMENT,
        clinicId: CLINIC,
        patientId: PATIENT,
        method: 'CARD',
        currency: 'PEN',
        amountMinor: 8_500,
        reference: '*** 4242',
        receivedAt: NOW,
      },
    ]);

    // The allocation names what the invoice was paid with, and the charges are
    // stamped by the same clock — the two records cannot name each other's bill.
    expect(recorded.allocations).toEqual([
      { paymentId: PAYMENT, invoiceId: INVOICE, amountMinor: 8_500 },
    ]);
    expect(recorded.markedInvoiced).toEqual([
      { clinicId: CLINIC, chargeIds: [CHARGE], invoiceId: INVOICE, invoicedAt: NOW },
    ]);
    // The answer is the row that was saved, not a second account of it.
    expect(payment).toEqual(recorded.payments[0]);
  });

  it('is born PARTIALLY_PAID when the payment covers part of the bill', async () => {
    const big = aCharge({ unitPriceMinor: 20_000 });
    const { recorded, dependencies } = harness({ storedCharges: [big] });

    await payVisitCharges(CLINIC, VISIT, { method: 'CASH', amountMinor: 5_000 }, dependencies);

    expect(recorded.invoices[0]?.status).toBe('PARTIALLY_PAID');
    // The money received names the invoice, and the invoice names the money.
    expect(recorded.allocations[0]).toEqual({
      paymentId: PAYMENT,
      invoiceId: INVOICE,
      amountMinor: 5_000,
    });
    // The charges a partial payment leaves here are still folded in: a bill was
    // raised, and "billed later" is not a state after a bill exists.
    expect(recorded.markedInvoiced[0]?.chargeIds).toEqual([big.id]);
  });

  it('refuses an amount over the outstanding bill and writes nothing in the transaction', async () => {
    const { recorded, dependencies } = harness({ storedCharges: [due] });

    await expect(
      payVisitCharges(CLINIC, VISIT, { method: 'CARD', amountMinor: 8_501 }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.invoices).toEqual([]);
    expect(recorded.payments).toEqual([]);
    expect(recorded.allocations).toEqual([]);
    expect(recorded.markedInvoiced).toEqual([]);
  });

  it.each([0, -100, 10.5, NaN])('refuses a payment of %s', async (amountMinor) => {
    const { recorded, dependencies } = harness({ storedCharges: [due] });

    await expect(
      payVisitCharges(CLINIC, VISIT, { method: 'CASH', amountMinor }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.payments).toEqual([]);
  });

  it('refuses to pay a visit with nothing un-invoiced — after a settlement or with no bill', async () => {
    let { recorded, dependencies } = harness({ storedCharges: [] });

    await expect(
      payVisitCharges(CLINIC, VISIT, { method: 'CASH', amountMinor: 100 }, dependencies),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'There is nothing left to pay on this visit',
    });
    expect(recorded.payments).toEqual([]);

    // The same answer for a bill whose charges all carry an invoice already: a
    // second payment on a settled visit collects the *invoice's* remaining balance,
    // and that ledger is Milestone 9, not a second path that reads the same rows.
    ({ recorded, dependencies } = harness({
      storedCharges: [aCharge({ invoiceId: INVOICE, invoicedAt: NOW })],
    }));
    await expect(
      payVisitCharges(CLINIC, VISIT, { method: 'CARD', amountMinor: 100 }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.payments).toEqual([]);
  });

  it('drops a blank reference to null, and refuses one beyond the ceiling', async () => {
    let { recorded, dependencies } = harness({ storedCharges: [due] });

    await payVisitCharges(
      CLINIC,
      VISIT,
      { method: 'CASH', amountMinor: 8_500, reference: '   ' },
      dependencies,
    );
    expect(recorded.payments[0]?.reference).toBeNull();

    ({ recorded, dependencies } = harness({ storedCharges: [due] }));
    await expect(
      payVisitCharges(
        CLINIC,
        VISIT,
        { method: 'CASH', amountMinor: 8_500, reference: 'x'.repeat(201) },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.payments).toEqual([]);
  });

  it('answers NOT_FOUND for a visit another clinic holds, and writes nothing', async () => {
    const { recorded, dependencies } = harness({ storedCharges: [due] });

    await expect(
      payVisitCharges(OTHER_CLINIC, VISIT, { method: 'CASH', amountMinor: 8_500 }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.payments).toEqual([]);
  });

  it('answers NOT_FOUND when the visit does not exist at all', async () => {
    const { recorded, dependencies } = harness({ visit: undefined });

    await expect(
      payVisitCharges(CLINIC, VISIT, { method: 'CASH', amountMinor: 8_500 }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.payments).toEqual([]);
  });

  it('answers NOT_FOUND when the clinic has gone between the reads', async () => {
    const { recorded, dependencies } = harness({ clinic: undefined });

    await expect(
      payVisitCharges(CLINIC, VISIT, { method: 'CASH', amountMinor: 8_500 }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.payments).toEqual([]);
  });
});

describe('listVisitPayments', () => {
  const received = (id: PaymentId) =>
    ({
      id,
      clinicId: CLINIC,
      patientId: PATIENT,
      method: 'CARD',
      currency: 'PEN',
      amountMinor: 8_500,
      reference: null,
      receivedAt: NOW,
    }) as Payment;

  it('returns the payments the repository holds, asked about this clinic’s visit', async () => {
    const held = [received(PAYMENT)];
    const { recorded, readDependencies } = harness({ storedPayments: held });

    const list = await listVisitPayments(CLINIC, VISIT, readDependencies);

    expect(list).toEqual(held);
    expect(recorded.paymentsRead).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, never an empty list', async () => {
    const { recorded, readDependencies } = harness();

    await expect(listVisitPayments(OTHER_CLINIC, VISIT, readDependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.paymentsRead).toEqual([]);
  });
});
