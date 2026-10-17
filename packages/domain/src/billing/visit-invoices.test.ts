/**
 * `issueVisitInvoice` and `nextInvoiceNumber` — raising a visit's bill as a numbered
 * document, collecting nothing.
 *
 * What is worth testing here is what the file decides, none of which throws when it
 * is wrong:
 *
 *  - **The document and the payment are separate acts.** Issuing writes an `ISSUED`
 *    invoice and nothing else — no payment, no allocation. `payVisitCharges` reuses
 *    this same step (its `visit-payments.test.ts` covers the settlement).
 *  - **Only the un-invoiced charges are folded in.** A charge already on a document
 *    is left where it is, so issuing twice cannot double-bill a line.
 *  - **A visit with nothing left to invoice is refused, not answered with an empty
 *    document.** An invoice of zero charges is not a bill.
 *  - **Tenancy comes through the visit and the clinic.** A visit this clinic does not
 *    hold answers `NOT_FOUND` before any row is written.
 *  - **What the caller owns is inherited, never restated.** The patient and currency
 *    come off the visit and the clinic; the id and the instant are the dependencies'.
 *
 * The clock, the id generator and the writes are asserted rather than trusted, the
 * same discipline `visit-payments.test.ts` keeps: an entity numbered or stamped by a
 * dependency is an entity the use case cannot testify about.
 */

import { describe, expect, it } from 'vitest';

import {
  asChargeId,
  asClinicId,
  asInvoiceId,
  asPatientId,
  asVisitId,
  type ChargeId,
  type ClinicId,
  type InvoiceId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type {
  ChargeRepository,
  ClinicRepository,
  InvoiceRepository,
  Repositories,
  UnitOfWork,
  VisitRepository,
} from '../ports/index.js';
import type { Clinic } from '../organization/index.js';
import type { Visit } from '../visit/index.js';
import type { Charge, Invoice } from './invoice.js';
import { issueVisitInvoice, nextInvoiceNumber } from './visit-invoices.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const CHARGE = asChargeId('77777777-7777-4777-8777-777777777777');
const OTHER_CHARGE = asChargeId('77777777-7777-4777-8777-777777777778');
const INVOICE = asInvoiceId('88888888-8888-4888-8888-888888888888');
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
    treatmentPlanItemId: null,
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
  markedInvoiced: {
    clinicId: ClinicId;
    chargeIds: readonly ChargeId[];
    invoiceId: InvoiceId;
    invoicedAt: string;
  }[];
  visitsRead: { clinicId: ClinicId; visitId: VisitId }[];
  clinicsRead: { clinicId: ClinicId }[];
}

function harness(
  options: {
    visit?: Visit;
    clinic?: Clinic;
    /** The charges `findForVisit` answers with; un-invoiced by default. */
    storedCharges?: readonly Charge[];
    /** What the store answers `issue` with — the number it assigned. */
    issuedNumber?: string;
  } = {},
) {
  const recorded: Recorded = {
    invoices: [],
    markedInvoiced: [],
    visitsRead: [],
    clinicsRead: [],
  };

  const storedVisit: Visit | undefined = 'visit' in options ? options.visit : openVisit();
  const storedClinic: Clinic | undefined = 'clinic' in options ? options.clinic : aClinic();

  const visits: VisitRepository = {
    findById: async (clinicId, visitId) => {
      recorded.visitsRead.push({ clinicId, visitId });
      return storedVisit && storedVisit.id === visitId && storedVisit.clinicId === clinicId
        ? storedVisit
        : undefined;
    },
    findOpenForPatient: async () => undefined,
    findForPatient: async () => [],
    updateStatus: async () => {},
    save: async () => {},
  };

  const clinics: ClinicRepository = {
    findById: async (clinicId) => {
      recorded.clinicsRead.push({ clinicId });
      return storedClinic && storedClinic.id === clinicId ? storedClinic : undefined;
    },
    getDefault: async () => storedClinic,
  };

  const charges: ChargeRepository = {
    findForVisit: async () => options.storedCharges ?? [],
    save: async () => {},
    markInvoiced: async (clinicId, chargeIds, invoiceId, invoicedAt) => {
      recorded.markedInvoiced.push({ clinicId, chargeIds, invoiceId, invoicedAt });
    },
  };

  const invoices: InvoiceRepository = {
    issue: async (invoice) => {
      recorded.invoices.push(invoice);
      return options.issuedNumber ?? 'F001-00001';
    },
    findForPatient: async () => undefined,
    findById: async () => undefined,
  };

  // The use case only sees the set through a transaction, so the harness fakes the
  // transaction and hands it the subset the issuing step touches.
  const unitOfWork: UnitOfWork = {
    transaction: async (work) =>
      work({ visits, clinics, charges, invoices } as unknown as Repositories),
  };

  return {
    recorded,
    dependencies: {
      unitOfWork,
      clock: { now: () => NOW },
      newInvoiceId: () => INVOICE,
    },
  };
}

describe('nextInvoiceNumber', () => {
  it('starts the series at one when nothing has been issued', () => {
    expect(nextInvoiceNumber([])).toBe('F001-00001');
  });

  it('is the highest issued number plus one, not the count plus one', () => {
    // A gap (00002 missing) must not be filled: reusing a number is worse than a gap.
    expect(nextInvoiceNumber(['F001-00001', 'F001-00003'])).toBe('F001-00004');
  });

  it('ignores numbers outside the series rather than parsing them as zero', () => {
    // A hand-entered or foreign number (the column is free text) must not be able to
    // stop the next real one, nor read as "one".
    expect(nextInvoiceNumber(['INV-9', 'F001-abc', 'F001-00002'])).toBe('F001-00003');
  });

  it('keeps the series width when the digits overflow', () => {
    expect(nextInvoiceNumber(['F001-99999'])).toBe('F001-100000');
  });
});

describe('issueVisitInvoice', () => {
  it('folds the visit’s un-invoiced charges into one numbered ISSUED document', async () => {
    const due = aCharge({ unitPriceMinor: 8_500 });
    const { recorded, dependencies } = harness({
      storedCharges: [due],
      issuedNumber: 'F001-00007',
    });

    const invoice = await issueVisitInvoice(CLINIC, VISIT, dependencies);

    // The document names what it inherits — the visit's patient, the clinic's
    // currency — and nothing the caller could have restated.
    expect(invoice.id).toBe(INVOICE);
    expect(invoice.clinicId).toBe(CLINIC);
    expect(invoice.patientId).toBe(PATIENT);
    expect(invoice.currency).toBe('PEN');
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.number).toBe('F001-00007');
    expect(invoice.issuedAt).toBe(NOW);
    expect(invoice.charges).toEqual([due]);

    expect(recorded.invoices).toHaveLength(1);
    expect(recorded.markedInvoiced).toEqual([
      { clinicId: CLINIC, chargeIds: [CHARGE], invoiceId: INVOICE, invoicedAt: NOW },
    ]);
  });

  it('leaves a charge that is already on a document where it is', async () => {
    const invoiced = aCharge({ id: CHARGE, invoiceId: INVOICE });
    const due = aCharge({ id: OTHER_CHARGE, unitPriceMinor: 3_000 });
    const { recorded, dependencies } = harness({ storedCharges: [invoiced, due] });

    const invoice = await issueVisitInvoice(CLINIC, VISIT, dependencies);

    expect(invoice.charges).toEqual([due]);
    // Only the un-invoiced charge is stamped — the already-billed one keeps its
    // original document.
    expect(recorded.markedInvoiced[0]?.chargeIds).toEqual([OTHER_CHARGE]);
  });

  it('refuses a visit with nothing left to invoice, writing nothing', async () => {
    const alreadyInvoiced = aCharge({ invoiceId: INVOICE });
    const { recorded, dependencies } = harness({ storedCharges: [alreadyInvoiced] });

    await expect(issueVisitInvoice(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'There is nothing left to invoice on this visit',
    });

    expect(recorded.invoices).toEqual([]);
    expect(recorded.markedInvoiced).toEqual([]);
  });

  it('refuses a visit with no charges at all the same way', async () => {
    const { recorded, dependencies } = harness({ storedCharges: [] });

    await expect(issueVisitInvoice(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    expect(recorded.invoices).toEqual([]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, writing nothing', async () => {
    const due = aCharge();
    // A visit that belongs to another clinic is invisible: the port answers undefined
    // for it exactly as it does for a missing one (ADR 0014).
    const { recorded, dependencies } = harness({
      visit: openVisit({ clinicId: OTHER_CLINIC }),
      storedCharges: [due],
    });

    await expect(issueVisitInvoice(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(recorded.invoices).toEqual([]);
    expect(recorded.markedInvoiced).toEqual([]);
  });

  it('takes the currency from the clinic, not the charges', async () => {
    // A charge priced in a stale currency must not price the document; the clinic's
    // own currency does.
    const due = aCharge({ currency: 'USD' });
    const { dependencies } = harness({ storedCharges: [due] });

    const invoice = await issueVisitInvoice(CLINIC, VISIT, dependencies);

    expect(invoice.currency).toBe('PEN');
  });
});
