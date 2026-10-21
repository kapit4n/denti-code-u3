/**
 * `getPatientBalance` — what a patient owes this clinic.
 *
 * The decisions worth testing are the ones that would otherwise show up as bugs:
 *
 *  - **The patient is the first thing decided.** An id this clinic does not hold
 *    throws `NOT_FOUND` before the clinic or the payments are read: a stranger's
 *    id and a patient who owes nothing must not be the same answer, and the
 *    payments read must not run for someone who is not here.
 *  - **The currency is the clinic's.** Not the first invoice's, and not a default:
 *    a patient with no documents at all still has a currency to be shown in, and
 *    inventing one would put a figure on a statement that the desk cannot take.
 *  - **The credit is what the money did not reach.** Allocations are only ever
 *    written against this patient's own invoices, so payments minus every invoice's
 *    allocated total is credit with nothing to spend it on.
 *  - **Nothing is recomputed.** The documents' stored totals are what the balance
 *    adds up, which is the answer the paper the patient was handed gives.
 */

import { describe, expect, it } from 'vitest';

import { asClinicId, asPatientId } from '@denti-code-u3/types';
import type { InvoiceId } from '@denti-code-u3/types';

import type { ClinicRepository, InvoiceRepository, PaymentRepository } from '../ports/index.js';
import type { InvoiceSummary } from '../ports/index.js';
import type { Clinic } from '../organization/clinic.js';
import { DomainError } from '../shared/errors.js';
import type { Payment } from './invoice.js';
import { getPatientBalance } from './patient-balance.js';

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
    findForPatient: async (clinicId, patientId) => {
      reads.push(`invoices:${String(clinicId === CLINIC_ID)}:${String(patientId === PATIENT_ID)}`);
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
    save: async () => {},
  };

  const clinics: ClinicRepository = {
    findById: async () => {
      reads.push('clinics');
      return 'clinic' in options ? options.clinic : aClinic();
    },
    getDefault: async () => aClinic(),
  };

  return { dependencies: { invoices, payments, clinics }, reads };
}

describe('getPatientBalance', () => {
  it('adds up what is still to collect across the open documents', async () => {
    const { dependencies } = harness({
      invoices: [
        summary({
          id: 'invoice-1' as unknown as InvoiceId,
          totalMinor: 30_000,
          allocatedMinor: 10_000,
        }),
        // A voided document's total must not bill, and its allocation must not be
        // subtracted from the money either — the payment it pointed at is unspent
        // again once the document is retired.
        summary({
          id: 'invoice-2' as unknown as InvoiceId,
          status: 'VOID',
          totalMinor: 40_000,
          allocatedMinor: 40_000,
        }),
      ],
      payments: [aPayment({ amountMinor: 10_000 })],
    });

    const balance = await getPatientBalance(CLINIC_ID, PATIENT_ID, dependencies);

    expect(balance).toEqual({
      currency: 'USD',
      billedMinor: 30_000,
      allocatedMinor: 10_000,
      outstandingMinor: 20_000,
      unallocatedPaymentsMinor: 0,
      balanceMinor: 20_000,
    });
  });

  it('answers NOT_FOUND before the clinic or the money is read', async () => {
    const { dependencies, reads } = harness({ invoices: undefined });

    await expect(getPatientBalance(CLINIC_ID, PATIENT_ID, dependencies)).rejects.toThrow(
      DomainError,
    );
    // Only the invoice read ran. A stranger's id must not buy a clinic lookup or a
    // payment scan — those happen for a patient who is here.
    expect(reads).toEqual(['invoices:true:true']);
  });

  it('takes the currency from the clinic, even for a patient with no documents', async () => {
    const { dependencies } = harness({ invoices: [], clinic: aClinic({ currency: 'PEN' }) });

    const balance = await getPatientBalance(CLINIC_ID, PATIENT_ID, dependencies);

    expect(balance).toEqual({
      currency: 'PEN',
      billedMinor: 0,
      allocatedMinor: 0,
      outstandingMinor: 0,
      unallocatedPaymentsMinor: 0,
      balanceMinor: 0,
    });
  });

  it('names the clinic that is missing when the clinic read comes up empty', async () => {
    const { dependencies } = harness({ invoices: [], clinic: undefined });

    await expect(getPatientBalance(CLINIC_ID, PATIENT_ID, dependencies)).rejects.toThrow('Clinic');
  });

  it('reports the payments that never reached a document as credit against the balance', async () => {
    const { dependencies } = harness({
      invoices: [
        summary({ totalMinor: 20_000, allocatedMinor: 20_000 }),
        // A second document with an allocation: credit is what is left after every
        // invoice's allocation, not after this one.
        summary({ id: 'invoice-2' as unknown as InvoiceId, totalMinor: 5_000, allocatedMinor: 0 }),
      ],
      payments: [
        aPayment({ amountMinor: 20_000 }),
        aPayment({
          id: '11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as Payment['id'],
          amountMinor: 7_000,
        }),
      ],
    });

    const balance = await getPatientBalance(CLINIC_ID, PATIENT_ID, dependencies);

    // 27_000 received − 20_000 allocated = 7_000 unallocated.
    expect(balance.unallocatedPaymentsMinor).toBe(7_000);
    // 25_000 billed − 20_000 allocated = 5_000 outstanding, less the 7_000 credit.
    expect(balance.balanceMinor).toBe(-2_000);
    expect(balance.outstandingMinor).toBe(5_000);
  });
});
