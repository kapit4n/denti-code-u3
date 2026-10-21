/**
 * What a patient owes — the ledger's summary line, Milestone 9's second slice.
 *
 * The first slice (`visit-invoices.ts`) raised documents and read them back; this
 * one answers the question the documents were raised to answer. It is a **read
 * over three existing ports**, not a fourth store of the number: a balance written
 * down and a balance derived would be two figures that drift apart, and the
 * invoices already carry everything needed to add one up.
 *
 * **The currency is the clinic's, not the first row's.** Reading it off an invoice
 * would make a patient with no bills have no currency to be shown in, which is the
 * one moment a balance screen most needs one. `issueVisitInvoice` reads the clinic
 * the same way, for the same reason.
 *
 * **`unallocatedPaymentsMinor` is money received minus money allocated.** Allocations
 * are only ever written against the patient's own invoices — `payVisitCharges` folds
 * a visit's charges into one document for the visit's patient — so the difference is
 * credit with nothing to spend it on. It is reported signed rather than clamped: a
 * patient in credit is a fact the desk needs, not a number to tidy away.
 *
 * A patient this clinic does not hold is a `NOT_FOUND`, never a zero balance.
 * "Nothing owed" and "not our patient" must not look the same on a statement.
 */

import type { ClinicId, PatientId } from '@denti-code-u3/types';
import { notFound } from '../shared/errors.js';
import type { ClinicRepository, InvoiceRepository, PaymentRepository } from '../ports/index.js';
import { calculatePatientBalance } from './invoice.js';
import type { PatientBalance } from './invoice.js';

/**
 * The three reads the balance is assembled from.
 *
 * Each is a `Pick` of the port it comes from rather than the whole repository, so
 * a caller cannot hand in a store that can write. The routes pass the repository
 * instances they already hold.
 */
export interface GetPatientBalanceDependencies {
  readonly invoices: Pick<InvoiceRepository, 'findForPatient'>;
  readonly payments: Pick<PaymentRepository, 'findForPatient'>;
  readonly clinics: Pick<ClinicRepository, 'findById'>;
}

export async function getPatientBalance(
  clinicId: ClinicId,
  patientId: PatientId,
  dependencies: GetPatientBalanceDependencies,
): Promise<PatientBalance> {
  // The subject first: a foreign patient is this route's own 404, and it should
  // be decided before the frame is read.
  const invoices = await dependencies.invoices.findForPatient(clinicId, patientId);

  if (!invoices) {
    throw notFound('Patient', patientId);
  }

  const clinic = await dependencies.clinics.findById(clinicId);

  if (!clinic) {
    throw notFound('Clinic', clinicId);
  }

  const payments = await dependencies.payments.findForPatient(clinicId, patientId);

  const receivedPaymentsMinor = payments.reduce((total, payment) => total + payment.amountMinor, 0);

  // The domain decides which allocations belong to a bill; the route just supplies
  // the money and the documents, so the rule lives in one place.
  return calculatePatientBalance(invoices, receivedPaymentsMinor, clinic.currency);
}
