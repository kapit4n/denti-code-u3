/**
 * The clinic's payments, as a page a manager can scan.
 *
 * The register on a visit answers "what was paid for this work"; this read answers
 * "what came in this week". The rows are the same `payments` rows, joined to the
 * patient's current name so a ledger does not need one request per row, and filtered
 * by an instant window rather than a clinic date because the route has already
 * resolved the clinic's calendar boundaries.
 *
 * `totalAmountMinor` is the sum of every row the filter matches, not of the page: a
 * ledger whose collected figure changed when the manager turned the page would be
 * answering a different question than the one it claims to. The clinic records one
 * currency, so the sum has one unit; the route reports that currency alongside it.
 */

import type { CurrencyCode, IsoDateTime, PatientId, PaymentId } from '@denti-code-u3/types';

import type { PaymentMethod } from './invoice.js';

export interface PaymentLedgerEntry {
  readonly id: PaymentId;
  readonly patientId: PatientId;
  /** Preferred name when the patient has one, otherwise `first last`. */
  readonly patientName: string;
  readonly method: PaymentMethod;
  readonly currency: CurrencyCode;
  readonly amountMinor: number;
  readonly reference: string | null;
  readonly receivedAt: IsoDateTime;
}

/**
 * What the repository may be asked for.
 *
 * `from` is inclusive and `to` exclusive, so the route can pass the clinic-local
 * midnights it resolved without a payment at 23:59 falling outside the day.
 */
export interface PaymentLedgerQuery {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly method?: PaymentMethod;
  readonly offset: number;
  readonly limit: number;
}

export interface PaymentLedgerPage {
  readonly items: readonly PaymentLedgerEntry[];
  readonly total: number;
  /** Sum of every matching row, not only the rows on this page. */
  readonly totalAmountMinor: number;
}
