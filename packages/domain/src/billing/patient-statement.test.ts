/**
 * `getPatientStatement` — the patient's ledger as a history.
 *
 * The decisions worth testing are the ones that would otherwise show up as a
 * plausible-looking wrong page:
 *
 *  - **Oldest first, with a running balance.** A statement read newest-first is a
 *    history that cannot be followed, and a balance that starts anywhere but zero
 *    is arithmetic nobody can check.
 *  - **Only issued documents are lines.** Drafts and voids are not bills; the money
 *    that once pointed at a voided document still is money received.
 *  - **A shared instant is ordered documents before payments**, so a payment never
 *    appears to have been made before the bill it settles, and the order does not
 *    depend on which repository answered first.
 *  - **The patient is the first thing decided**, exactly as the balance read is: a
 *    stranger's id must not buy a clinic lookup or a payment scan.
 *  - **The currency is the clinic's**, so an empty statement still has one.
 */

import { describe, expect, it } from 'vitest';

import { asClinicId, asPatientId } from '@denti-code-u3/types';
import type { InvoiceId, PaymentId } from '@denti-code-u3/types';

import type { ClinicRepository, InvoiceRepository, PaymentRepository } from '../ports/index.js';
import type { InvoiceSummary } from '../ports/index.js';
import type { Clinic } from '../organization/clinic.js';
import { DomainError } from '../shared/errors.js';
import type { Payment } from './invoice.js';
import { getPatientStatement } from './patient-statement.js';

const CLINIC_ID = asClinicId('11111111-1111-4111-8111-111111111111');
const PATIENT_ID = asPatientId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

function aClinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    id: CLINIC_ID as unknown as Clinic['id'],
    name: 'Denti-Code',
    timeZone: 'UTC',
    currency: 'USD',
    operatingHours: [],
    settings: {},
    ...overrides,
  };
}

function summary(overrides: Partial<InvoiceSummary> = {}): InvoiceSummary {
  return {
    id: 'invoice-1' as unknown as InvoiceId,
    patientId: PATIENT_ID as unknown as InvoiceSummary['patientId'],
    number: 'F001-00001',
    status: 'ISSUED',
    currency: 'USD',
    subtotalMinor: 20_000,
    discountMinor: 0,
    taxRatePercent: 0,
    totalMinor: 20_000,
    allocatedMinor: 0,
    balanceMinor: 20_000,
    chargeCount: 1,
    issuedAt: '2026-10-05T14:00:00.000Z' as InvoiceSummary['issuedAt'],
    createdAt: '2026-10-05T14:00:00.000Z' as InvoiceSummary['createdAt'],
    ...overrides,
  };
}

function aPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as Payment['id'],
    clinicId: CLINIC_ID as unknown as Payment['clinicId'],
    patientId: PATIENT_ID as unknown as Payment['patientId'],
    method: 'CASH',
    currency: 'USD',
    amountMinor: 0,
    reference: null,
    receivedAt: '2026-10-05T14:00:00.000Z' as Payment['receivedAt'],
    ...overrides,
  };
}

interface HarnessOptions {
  /** `undefined` stands for "this clinic does not hold that patient". */
  readonly invoices?: readonly InvoiceSummary[] | undefined;
  readonly payments?: readonly Payment[];
  readonly clinic?: Clinic | undefined;
}

function harness(options: HarnessOptions = {}) {
  const reads: string[] = [];

  const invoices: InvoiceRepository = {
    findForPatient: async () => {
      reads.push('invoices');
      return 'invoices' in options ? options.invoices : [];
    },
    findById: async () => undefined,
    issue: async () => 'F001-00001',
    updateStatus: async () => {},
  };

  const payments: PaymentRepository = {
    findForVisit: async () => [],
    findForPatient: async () => {
      reads.push('payments');
      return options.payments ?? [];
    },
    listForClinic: async () => ({ items: [], total: 0, totalAmountMinor: 0 }),
    save: async () => {},
  };

  const clinics: ClinicRepository = {
    findById: async () => {
      reads.push('clinics');
      return 'clinic' in options ? options.clinic : aClinic();
    },
    getDefault: async () => aClinic(),
    updateSettings: async () => aClinic(),
  };

  return { dependencies: { invoices, payments, clinics }, reads };
}

describe('getPatientStatement', () => {
  it('lists the lines oldest first and prints the balance after each one', async () => {
    const { dependencies } = harness({
      invoices: [
        summary({
          id: 'invoice-2' as unknown as InvoiceId,
          number: 'F001-00002',
          totalMinor: 10_000,
          issuedAt: '2026-10-07T09:00:00.000Z' as InvoiceSummary['issuedAt'],
        }),
        summary({
          id: 'invoice-1' as unknown as InvoiceId,
          number: 'F001-00001',
          totalMinor: 20_000,
          issuedAt: '2026-10-05T09:00:00.000Z' as InvoiceSummary['issuedAt'],
        }),
      ],
      payments: [
        aPayment({
          id: 'pay-2' as unknown as PaymentId,
          amountMinor: 7_000,
          method: 'CARD',
          reference: '*** 4242',
          receivedAt: '2026-10-08T09:00:00.000Z' as Payment['receivedAt'],
        }),
        aPayment({
          id: 'pay-1' as unknown as PaymentId,
          amountMinor: 5_000,
          receivedAt: '2026-10-06T09:00:00.000Z' as Payment['receivedAt'],
        }),
      ],
    });

    const statement = await getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies);

    // The repositories answered newest-first; the statement is a history.
    expect(statement.entries.map((entry) => entry.kind)).toEqual([
      'INVOICE',
      'PAYMENT',
      'INVOICE',
      'PAYMENT',
    ]);
    expect(statement.entries.map((entry) => entry.reference)).toEqual([
      'F001-00001',
      null,
      'F001-00002',
      '*** 4242',
    ]);
    // 20_000 billed, 5_000 paid, 10_000 billed, 7_000 paid.
    expect(statement.entries.map((entry) => entry.balanceMinor)).toEqual([
      20_000, 15_000, 25_000, 18_000,
    ]);
    expect(statement.entries[1]).toMatchObject({ debitMinor: 0, creditMinor: 5_000 });
    expect(statement.entries[3]).toMatchObject({ method: 'CARD' });

    expect(statement).toMatchObject({
      currency: 'USD',
      billedMinor: 30_000,
      paidMinor: 12_000,
      closingBalanceMinor: 18_000,
    });
  });

  it('leaves draft and void documents off, but keeps the money that pointed at them', async () => {
    const { dependencies } = harness({
      invoices: [
        summary({ status: 'ISSUED', totalMinor: 20_000 }),
        summary({
          id: 'invoice-draft' as unknown as InvoiceId,
          status: 'DRAFT',
          totalMinor: 99_000,
          issuedAt: null,
        }),
        summary({
          id: 'invoice-void' as unknown as InvoiceId,
          status: 'VOID',
          totalMinor: 40_000,
        }),
      ],
      payments: [aPayment({ amountMinor: 25_000 })],
    });

    const statement = await getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies);

    expect(statement.entries).toHaveLength(2);
    expect(statement.billedMinor).toBe(20_000);
    // The 25_000 was received regardless of the voided document, so the statement
    // shows 5_000 of credit — the same answer the balance read gives.
    expect(statement.paidMinor).toBe(25_000);
    expect(statement.closingBalanceMinor).toBe(-5_000);
  });

  it('puts a document before a payment that shares its instant, whichever read answered first', async () => {
    const { dependencies } = harness({
      invoices: [summary({ issuedAt: '2026-10-05T09:00:00.000Z' as InvoiceSummary['issuedAt'] })],
      payments: [aPayment({ receivedAt: '2026-10-05T09:00:00.000Z' as Payment['receivedAt'] })],
    });

    const statement = await getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies);

    expect(statement.entries.map((entry) => entry.kind)).toEqual(['INVOICE', 'PAYMENT']);
    expect(statement.entries.map((entry) => entry.balanceMinor)).toEqual([20_000, 20_000]);
  });

  it('shows a prepayment as a negative running balance rather than hiding it', async () => {
    const { dependencies } = harness({
      invoices: [
        summary({
          totalMinor: 10_000,
          issuedAt: '2026-10-07T09:00:00.000Z' as InvoiceSummary['issuedAt'],
        }),
      ],
      payments: [
        aPayment({
          amountMinor: 5_000,
          receivedAt: '2026-10-06T09:00:00.000Z' as Payment['receivedAt'],
        }),
      ],
    });

    const statement = await getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies);

    expect(statement.entries.map((entry) => entry.balanceMinor)).toEqual([-5_000, 5_000]);
  });

  it('answers NOT_FOUND before the clinic or the money is read', async () => {
    const { dependencies, reads } = harness({ invoices: undefined });

    await expect(getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies)).rejects.toThrow(
      DomainError,
    );
    // Only the invoice read ran. A stranger's id must not buy a clinic lookup or a
    // payment scan.
    expect(reads).toEqual(['invoices']);
  });

  it('takes the currency from the clinic, even for a patient with no lines', async () => {
    const { dependencies } = harness({ invoices: [], clinic: aClinic({ currency: 'PEN' }) });

    const statement = await getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies);

    expect(statement).toEqual({
      currency: 'PEN',
      billedMinor: 0,
      paidMinor: 0,
      closingBalanceMinor: 0,
      entries: [],
    });
  });

  it('names the clinic that is missing when the clinic read comes up empty', async () => {
    const { dependencies } = harness({ invoices: [], clinic: undefined });

    await expect(getPatientStatement(CLINIC_ID, PATIENT_ID, dependencies)).rejects.toThrow(
      'Clinic',
    );
  });
});
