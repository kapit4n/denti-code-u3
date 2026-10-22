/**
 * A patient's statement — the ledger read as a line-by-line history.
 *
 * The balance (`patient-balance.ts`) answers "what is owed now". A statement answers
 * the question the desk asks next: "how did we get here?" It is the same two reads
 * (the patient's documents and the money received) put in order, with the balance
 * printed after every line. Like the balance, it is **derived, not stored**: a
 * statement kept in a table would be a second ledger that drifts the moment a
 * payment is allocated, and the rows to reconstruct it already exist.
 *
 * **Only issued documents are lines on it.** A `DRAFT` has not been handed to the
 * patient and a `VOID` has been retired; printing either would make the history
 * disagree with the balance and with the paper the patient holds. The payments that
 * once pointed at a voided document stay on the statement — the money was still
 * received — which is exactly how a statement can show credit.
 *
 * **The running balance is signed, not clamped.** A payment made in advance puts the
 * running balance below zero until an invoice follows it, and that is a fact the desk
 * needs to see. The closing figure equals the balance read's `balanceMinor`: billed
 * minus received, with allocation deliberately absent from the arithmetic because how
 * money was pointed at documents is bookkeeping, not the amount owed.
 */

import type {
  ClinicId,
  CurrencyCode,
  InvoiceId,
  IsoDateTime,
  PatientId,
  PaymentId,
} from '@denti-code-u3/types';

import { notFound } from '../shared/errors.js';
import type { ClinicRepository, InvoiceRepository, PaymentRepository } from '../ports/index.js';
import type { PaymentMethod } from './invoice.js';

/** A line's direction: a document bills, a payment settles. */
export type PatientStatementEntryKind = 'INVOICE' | 'PAYMENT';

/** One line of the statement, with the balance it leaves behind. */
export interface PatientStatementEntry {
  readonly kind: PatientStatementEntryKind;
  readonly id: InvoiceId | PaymentId;
  /** The invoice number, or the payment's free-text reference; null when neither exists. */
  readonly reference: string | null;
  /** The way the money arrived; null on a document line. */
  readonly method: PaymentMethod | null;
  /** When the document was issued, or when the money was received. */
  readonly occurredAt: IsoDateTime;
  /** Money billed on this line; zero on a payment. */
  readonly debitMinor: number;
  /** Money received on this line; zero on a document. */
  readonly creditMinor: number;
  /** The running balance after this line, oldest line first. */
  readonly balanceMinor: number;
}

/**
 * The statement as a screen draws it.
 *
 * `billedMinor` and `paidMinor` are the column totals; `closingBalanceMinor` is the
 * last running balance and, by construction, `billed - paid`. All three are in the
 * **clinic's** currency, including for a patient with no lines at all.
 */
export interface PatientStatement {
  readonly currency: CurrencyCode;
  readonly billedMinor: number;
  readonly paidMinor: number;
  readonly closingBalanceMinor: number;
  readonly entries: readonly PatientStatementEntry[];
}

/**
 * The three reads the statement is assembled from.
 *
 * `Pick`s rather than the whole ports, for the same reason the balance takes them:
 * a caller cannot hand in a store that can write. The routes pass the repositories
 * they already hold.
 */
export interface GetPatientStatementDependencies {
  readonly invoices: Pick<InvoiceRepository, 'findForPatient'>;
  readonly payments: Pick<PaymentRepository, 'findForPatient'>;
  readonly clinics: Pick<ClinicRepository, 'findById'>;
}

/** Documents first on a shared instant, so a payment never lands before its bill. */
const KIND_ORDER: Record<PatientStatementEntryKind, number> = {
  INVOICE: 0,
  PAYMENT: 1,
};

/**
 * Build a patient's statement, oldest line first, with a running balance.
 *
 * The patient is decided **first**: a foreign id throws `NOT_FOUND` before the clinic
 * or the payments are read, so a stranger's id cannot buy a lookup and "not our
 * patient" does not look like "nothing billed".
 *
 * Ordering is by the moment the line happened (a document's issue instant, a
 * payment's receipt instant). Two lines sharing an instant are ordered documents
 * before payments, then by id, so the answer is stable rather than dependent on the
 * order the two repositories happened to return.
 */
export async function getPatientStatement(
  clinicId: ClinicId,
  patientId: PatientId,
  dependencies: GetPatientStatementDependencies,
): Promise<PatientStatement> {
  const invoices = await dependencies.invoices.findForPatient(clinicId, patientId);

  if (!invoices) {
    throw notFound('Patient', patientId);
  }

  const clinic = await dependencies.clinics.findById(clinicId);

  if (!clinic) {
    throw notFound('Clinic', clinicId);
  }

  const payments = await dependencies.payments.findForPatient(clinicId, patientId);

  const unbilled: Omit<PatientStatementEntry, 'balanceMinor'>[] = [
    ...invoices
      .filter((invoice) => invoice.status !== 'DRAFT' && invoice.status !== 'VOID')
      .map((invoice) => ({
        kind: 'INVOICE' as const,
        id: invoice.id,
        reference: invoice.number,
        method: null,
        occurredAt: invoice.issuedAt ?? invoice.createdAt,
        debitMinor: invoice.totalMinor,
        creditMinor: 0,
      })),
    ...payments.map((payment) => ({
      kind: 'PAYMENT' as const,
      id: payment.id,
      reference: payment.reference,
      method: payment.method,
      occurredAt: payment.receivedAt,
      debitMinor: 0,
      creditMinor: payment.amountMinor,
    })),
  ];

  unbilled.sort((a, b) => {
    const byTime = a.occurredAt.localeCompare(b.occurredAt);
    if (byTime !== 0) {
      return byTime;
    }
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return byKind !== 0 ? byKind : a.id.localeCompare(b.id);
  });

  let running = 0;
  let billedMinor = 0;
  let paidMinor = 0;

  const entries = unbilled.map((entry) => {
    billedMinor += entry.debitMinor;
    paidMinor += entry.creditMinor;
    running += entry.debitMinor - entry.creditMinor;
    return { ...entry, balanceMinor: running };
  });

  return {
    currency: clinic.currency,
    billedMinor,
    paidMinor,
    closingBalanceMinor: running,
    entries,
  };
}
