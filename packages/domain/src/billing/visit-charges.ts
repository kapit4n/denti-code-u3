/**
 * The charges raised on a visit — the smallest whole slice of the workspace's
 * "Charges" section.
 *
 * **A charge is the first billing row with a clinic of its own**, and that changes
 * the shape of the write next to its clinical siblings. `clinical_notes`,
 * `visit_treatment_executions` and `prescriptions` carry `visit_id` and no
 * `clinic_id`; `charges` carries both. Both use cases still read the visit first —
 * the read is what decides whether this clinic may see or raise a charge, and one
 * for another clinic's visit is `NOT_FOUND`, indistinguishable from a visit that
 * does not exist (ADR 0014). The repository's `findForVisit` re-scopes through its
 * own `clinic_id` filter for the same reason, defence in depth on a read.
 *
 * **Who and what the row names is inherited or owned, never restated.** `patientId`
 * and `visitId` come from the visit, and the currency comes from the *clinic* — the
 * one thing a price is denominated in that neither the request nor the visit can
 * say (`visits` has no currency). The request therefore carries only the
 * description and the price: a client must not tell a clinic what currency its own
 * charges are priced in, because a request that could would be a request that could
 * name it wrongly.
 *
 * **`taxRatePercent` is zero here, and that is a decision with an OPEN QUESTION
 * beside it.** A charge raised by hand on a visit carries no tax field — the schema
 * refuses a price before tax has even been decided for this slice, and giving the
 * body a tax field that is always stored would be a control that does nothing. When
 * tax arrives it will be on the charge, the clinic or the invoice; `deriveInvoiceStatus`
 * and the invoice totals already read it wherever it lands. Recorded in
 * `docs/open-questions.md` with the billing rows, so the decision is not forgotten.
 *
 * **Reading *then* writing, and no `UnitOfWork`.** A foreign visit must answer 404
 * before anything is inserted, so the refusal arrives as a domain error rather than
 * as a foreign-key violation translated afterwards; and once the visit is proven,
 * one row, one statement — ceremony is a unit of work around a single insert.
 *
 * **The order a reader sees is `created_at` then id** — the chronological record of
 * how the bill grew, decided by the repository for the same reason the patient
 * timeline's order is (ADR 0023).
 */
import type { ChargeId, ClinicId, VisitId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { ChargeRepository, ClinicRepository, VisitRepository } from '../ports/index.js';
import { getVisit } from '../visit/visit-read.js';
import type { Charge } from './invoice.js';

/** A charge is not its own subject: the visit scopes both uses. */
export interface ChargeReadDependencies {
  readonly visits: VisitRepository;
  readonly charges: ChargeRepository;
}

/** A write adds the three things only a writer knows: whose clock, what id, what currency. */
export interface ChargeWriteDependencies extends ChargeReadDependencies {
  readonly clinics: ClinicRepository;
  readonly clock: Clock;
  readonly newId: () => ChargeId;
}

/** The body a caller hands to the write use case, in domain terms. */
export interface NewCharge {
  readonly description: string;
  /** Defaults to 1 when omitted, so a single service is not forced to type a quantity. */
  readonly quantity?: number;
  readonly unitPriceMinor: number;
  /** Defaults to 0 when omitted. Never negative. */
  readonly discountMinor?: number;
}

/**
 * Every charge on one visit, in the order the bill was built — the order a clinician
 * reads a charge in, and the repository's to decide (ADR 0023).
 *
 * 404 for a visit this clinic does not hold, and `[]` only for a visit that does.
 * This is the subject-shaped read of `getVisit`, not the subject-less list of a
 * patient: charges belong to a visit, so the visit has to be there before its
 * charges can be an empty truth.
 */
export async function listVisitCharges(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: ChargeReadDependencies,
): Promise<readonly Charge[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.charges.findForVisit(clinicId, visitId);
}

/**
 * Raise a charge on a visit this clinic holds.
 *
 * **The order is the whole contract**: the visit first (the subject — a foreign visit
 * is `NOT_FOUND`), then the clinic that prices it, then each field judged on its own,
 * and only then the insert. `patientId` and `visitId` are copied from the visit and
 * the currency from the clinic, never taken from the request; `createdAt` is stamped
 * by the clock; and the id comes from the caller's generator — the same division of
 * labour every write here has, so a test can hold both still.
 *
 * Blank free text is `INVALID_INPUT` rather than a stored empty row ("a charge needs
 * a description"), because the schema refuses it at the boundary with a sentence a
 * client can show and this refusal is the rule itself. A non-positive or non-finite
 * quantity and a negative price or discount are refused here too, because money is
 * the one thing no boundary schema can be trusted with twice.
 */
export async function addVisitCharge(
  clinicId: ClinicId,
  visitId: VisitId,
  input: NewCharge,
  dependencies: ChargeWriteDependencies,
): Promise<Charge> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const clinic = await dependencies.clinics.findById(clinicId);

  // The visit proved the clinic exists a statement ago, so this is a defence, not a
  // path a caller can reach twice — but a clinic deleted between the two reads would
  // otherwise price a charge in a currency that no longer means anything here.
  if (!clinic) {
    throw notFound('Clinic', clinicId);
  }

  const description = input.description.trim();

  if (!description) {
    throw new DomainError('INVALID_INPUT', 'A charge needs a description', { visitId });
  }

  if (description.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The description is too long', { description });
  }

  const quantity = input.quantity ?? 1;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new DomainError('INVALID_INPUT', 'A quantity must be greater than zero', {
      quantity,
    });
  }

  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    throw new DomainError('INVALID_INPUT', 'A unit price cannot be negative', {
      unitPriceMinor: input.unitPriceMinor,
    });
  }

  const discountMinor = input.discountMinor ?? 0;

  if (!Number.isInteger(discountMinor) || discountMinor < 0) {
    throw new DomainError('INVALID_INPUT', 'A discount cannot be negative', { discountMinor });
  }

  const charge: Charge = {
    id: dependencies.newId(),
    clinicId,
    patientId: visit.patientId,
    visitId,
    treatmentId: null,
    description,
    quantity,
    unitPriceMinor: input.unitPriceMinor,
    discountMinor,
    taxRatePercent: 0,
    currency: clinic.currency,
    invoiceId: null,
    invoicedAt: null,
    createdAt: dependencies.clock.now(),
  };

  await dependencies.charges.save(charge);

  return charge;
}
