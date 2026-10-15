/**
 * Invoicing a visit's bill, and reading invoices back — Milestone 9's first cut
 * at the ledger.
 *
 * **The document is a separate act from the payment.** Money and paper used to be
 * one move: `payVisitCharges` raised an invoice only as the side effect of
 * settling it, so a bill could not exist before it was paid and no invoice had a
 * number a human could quote. Here the two are split — `issueVisitInvoice` folds
 * a visit's un-invoiced charges into one numbered `ISSUED` document and writes
 * nothing else, and the settlement reuses that same issuing step when it has to
 * raise the bill itself. One implementation of "fold these charges into a
 * document, number it, stamp them invoiced", so a payment path and a billing path
 * cannot number a document two different ways (ADR 0011's one-implementation
 * rule, applied to a document).
 *
 * **The number is assigned by the store, not the caller.** `F001-00001`, the
 * highest issued plus one, computed from the numbers already in the clinic —
 * exactly the record-number rule (see `nextPatientRecordNumber`), and enforced
 * the same way: the `(clinic_id, number)` unique index rejects a collision and
 * the repository reads the highest under a transaction-scoped lock. A number
 * invented by the caller is either a duplicate in front of the patient or a gap
 * somebody has to explain.
 *
 * **What is left open, and told rather than hidden.** The `F001` series and the
 * five-digit width are the simplest assumption that satisfies open question 4
 * (fiscal numbering); a real country's series code, taxes and due dates are not
 * modelled. Reading a *statement* — every invoice and payment a patient has, with
 * a running balance — is the ledger's next slice; this one issues and reads the
 * documents themselves.
 *
 * The two read models (`InvoiceSummary`, `InvoiceDetail`) live with the port that
 * returns them, in `ports/index.ts`, because they are shapes the store assembles
 * rather than domain entities — the same home `TreatmentPlanSummary` has.
 */

import type {
  ClinicId,
  CurrencyCode,
  InvoiceId,
  IsoDateTime,
  PatientId,
  VisitId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { InvoiceRepository, Repositories, UnitOfWork } from '../ports/index.js';
import type { Charge, Invoice, InvoiceStatus } from './invoice.js';

/**
 * The document-number series.
 *
 * `F001` is the series code and the number is zero-padded to five digits, so
 * `F001-00001` sorts correctly as text and keeps its width well past any
 * plausible invoice count — the record-number rule, on the other document a
 * clinic quotes out loud. The assumption is recorded in `docs/open-questions.md`
 * (question 4): a real fiscal regime names its own series and width.
 */
const INVOICE_NUMBER_PREFIX = 'F001-';
const INVOICE_NUMBER_DIGITS = 5;

/**
 * Next invoice number for a clinic: the highest issued number plus one.
 *
 * A pure function of the numbers already issued, so the domain decides the shape
 * and the repository only has to read the highest and guard the insert. A number
 * that does not match the series is ignored rather than parsed as a `NaN` — a
 * hand-entered number (none exist through the API, but the column is free text)
 * must not be able to stop the next real one.
 */
export function nextInvoiceNumber(issued: readonly string[]): string {
  const highest = issued.reduce((max, number) => {
    if (!number.startsWith(INVOICE_NUMBER_PREFIX)) {
      return max;
    }
    const digits = number.slice(INVOICE_NUMBER_PREFIX.length);
    if (!/^\d+$/.test(digits)) {
      return max;
    }
    return Math.max(max, Number.parseInt(digits, 10));
  }, 0);

  return `${INVOICE_NUMBER_PREFIX}${String(highest + 1).padStart(INVOICE_NUMBER_DIGITS, '0')}`;
}

/** Every `charge` the caller owns, and the frame the document is written in. */
export interface IssueInvoiceRequest {
  readonly clinicId: ClinicId;
  readonly patientId: PatientId;
  readonly currency: CurrencyCode;
  readonly charges: readonly Charge[];
  readonly invoiceId: InvoiceId;
  readonly issuedAt: IsoDateTime;
  /**
   * The status the document is born with.
   *
   * `ISSUED` when the bill is raised on its own; the settlement passes the status
   * `deriveInvoiceStatus` gives a freshly-allocated document, so an invoice is
   * never briefly `ISSUED` before the same transaction makes it `PAID`.
   */
  readonly status: InvoiceStatus;
}

/**
 * Fold `charges` into one numbered invoice and stamp them invoiced.
 *
 * Runs on the repositories the caller is already inside a transaction with —
 * there is no `this.db.transaction` in here, because issuing is one of several
 * statements a settlement makes and a nested transaction would be a second
 * boundary inside the first. The two statements, in order: the document first, so
 * a charge visible as invoiced can never name a document that does not exist.
 */
export async function issueInvoice(
  repositories: Repositories,
  request: IssueInvoiceRequest,
): Promise<Invoice> {
  const invoice: Invoice = {
    id: request.invoiceId,
    clinicId: request.clinicId,
    patientId: request.patientId,
    currency: request.currency,
    status: request.status,
    // Assigned by the store; the entity carries null until it has been.
    number: null,
    issuedAt: request.issuedAt,
    discountMinor: 0,
    taxRatePercent: 0,
    charges: request.charges,
  };

  const number = await repositories.invoices.issue(invoice);

  await repositories.charges.markInvoiced(
    request.clinicId,
    request.charges.map((charge) => charge.id),
    request.invoiceId,
    request.issuedAt,
  );

  return { ...invoice, number };
}

export interface IssueVisitInvoiceDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly newInvoiceId: () => InvoiceId;
}

/**
 * Raise a visit's un-invoiced bill as one numbered invoice, collecting nothing.
 *
 * The whole thing runs inside one transaction: the visit read, the clinic read
 * (whose currency prices the document), the charges, and the two writes. The visit
 * is read first, so a foreign visit is a `NOT_FOUND` before any money is discussed;
 * a visit with nothing left un-invoiced is an `INVALID_INPUT` rather than an empty
 * document — an invoice of zero charges is not a bill.
 */
export async function issueVisitInvoice(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: IssueVisitInvoiceDependencies,
): Promise<Invoice> {
  return dependencies.unitOfWork.transaction(async (repositories) => {
    const visit = await repositories.visits.findById(clinicId, visitId);

    if (!visit) {
      throw notFound('Visit', visitId);
    }

    const clinic = await repositories.clinics.findById(clinicId);

    if (!clinic) {
      throw notFound('Clinic', clinicId);
    }

    const charges = await repositories.charges.findForVisit(clinicId, visitId);
    const uninvoiced = charges.filter((charge) => charge.invoiceId === null);

    if (uninvoiced.length === 0) {
      throw new DomainError('INVALID_INPUT', 'There is nothing left to invoice on this visit', {
        visitId,
      });
    }

    return issueInvoice(repositories, {
      clinicId,
      patientId: visit.patientId,
      currency: clinic.currency,
      charges: uninvoiced,
      invoiceId: dependencies.newInvoiceId(),
      issuedAt: dependencies.clock.now(),
      status: 'ISSUED',
    });
  });
}

/** The port the two invoice reads share; the routes call it directly, as the plan read does. */
export type InvoiceReader = Pick<InvoiceRepository, 'findForPatient' | 'findById'>;
