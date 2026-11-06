/**
 * Marking one line of a treatment plan done.
 *
 * A plan item is done or it is not — the table has no per-item status, and this is
 * the only write that flips the flag. Completing is **idempotent by keeping the
 * first stamp**: an item already done is left alone, so `completedAt` records when
 * the treatment was actually finished and a second tap cannot move it. The item has
 * to belong to the plan on the path — a mismatched id is a 404, never a silent
 * no-op, because a save that succeeded while nothing changed is the worst answer a
 * write can give.
 *
 * **Completion is also the moment the line is billed.** When billing dependencies
 * are supplied, the same transaction raises one charge from the item's estimate and
 * issues its invoice, so the patient's balance moves when the work is finished
 * rather than waiting for a second, easily forgotten write. The charge is linked to
 * the planned line and looked up first: a retry (or a charge raised by hand) is not
 * a second charge, and an invoice already issued is not issued again. A visit may
 * ask for the invoice to be deferred, so closing the visit can fold all of its
 * charges into one document.
 *
 * The patient is read first and the plan is read scoped to both the clinic and that
 * patient (ADR 0014), so neither a foreign patient nor another patient's plan can
 * be reached through this path.
 */
import type {
  ChargeId,
  ClinicId,
  InvoiceId,
  IsoDateTime,
  PatientId,
  TreatmentPlanId,
  VisitId,
} from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';
import type {
  PatientRepository,
  Repositories,
  TreatmentPlanItemSummary,
  TreatmentPlanRepository,
  UnitOfWork,
} from '../ports/index.js';
import type { Charge } from '../billing/invoice.js';
import { issueInvoice } from '../billing/visit-invoices.js';

/** The plan write half, whether it comes from the route or a transaction. */
interface PlanWriteRepositories {
  readonly patients: Pick<PatientRepository, 'findProfile'>;
  readonly treatmentPlans: Pick<TreatmentPlanRepository, 'getForPatient' | 'save'>;
}

export interface CompleteTreatmentPlanItemBillingDependencies {
  /** Completes the line, raises its charge and issues the invoice as one unit. */
  readonly unitOfWork: UnitOfWork;
  readonly newChargeId: () => ChargeId;
  readonly newInvoiceId: () => InvoiceId;
  /**
   * The visit the completion happened in, when it happened in one.
   *
   * A plan line completed from the patient record has no visit in hand; the latest
   * session's visit is then the honest link, and null means billing outside a visit.
   */
  readonly visitId?: VisitId | null;
  /**
   * Raise the charge but leave its invoice to the caller.
   *
   * Closing a visit uses this so every line selected in the closure dialog, plus
   * any charges already on the bill, become one document instead of one each.
   */
  readonly deferInvoice?: boolean;
}

export interface CompleteTreatmentPlanItemDependencies extends PlanWriteRepositories {
  readonly clock: Clock;
  readonly billing?: CompleteTreatmentPlanItemBillingDependencies;
}

export async function completeTreatmentPlanItem(
  clinicId: ClinicId,
  patientId: PatientId,
  planId: TreatmentPlanId,
  itemId: string,
  dependencies: CompleteTreatmentPlanItemDependencies,
): Promise<void> {
  const billing = dependencies.billing;

  if (!billing) {
    await markCompleted(
      clinicId,
      patientId,
      planId,
      itemId,
      dependencies,
      dependencies.clock.now(),
    );
    return;
  }

  await billing.unitOfWork.transaction(async (repositories) => {
    const now = dependencies.clock.now();

    await markCompleted(clinicId, patientId, planId, itemId, repositories, now);
    await billCompletedItem(clinicId, patientId, itemId, repositories, dependencies.clock, billing);
  });
}

async function markCompleted(
  clinicId: ClinicId,
  patientId: PatientId,
  planId: TreatmentPlanId,
  itemId: string,
  repositories: PlanWriteRepositories,
  now: IsoDateTime,
): Promise<void> {
  const patient = await repositories.patients.findProfile(clinicId, patientId);
  if (!patient) {
    throw notFound('Patient', patientId);
  }

  const plan = await repositories.treatmentPlans.getForPatient(clinicId, patientId, planId);
  if (!plan) {
    throw notFound('TreatmentPlan', planId);
  }

  const item = plan.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw notFound('TreatmentPlanItem', itemId);
  }

  // Already done: leave the first stamp where it is. Billing still runs below,
  // because a previous attempt may have completed the line before its invoice.
  if (item.isCompleted) {
    return;
  }

  await repositories.treatmentPlans.save({
    ...plan,
    items: plan.items.map((candidate) =>
      candidate.id === itemId ? { ...candidate, isCompleted: true, completedAt: now } : candidate,
    ),
    updatedAt: now,
  });
}

async function billCompletedItem(
  clinicId: ClinicId,
  patientId: PatientId,
  itemId: string,
  repositories: Repositories,
  clock: Clock,
  billing: CompleteTreatmentPlanItemBillingDependencies,
): Promise<void> {
  const plans = await repositories.treatmentPlans.listForPatient(clinicId, patientId);

  if (!plans) {
    throw notFound('Patient', patientId);
  }

  const item = plans.flatMap((plan) => plan.items).find((candidate) => candidate.id === itemId);

  if (!item) {
    throw notFound('TreatmentPlanItem', itemId);
  }

  const existing = await repositories.charges.findForTreatmentPlanItem(clinicId, itemId);
  const charge =
    existing ??
    (await raisePlanItemCharge(clinicId, patientId, item, repositories, clock, billing));

  if (!charge || charge.invoiceId !== null || billing.deferInvoice) {
    return;
  }

  await issueInvoice(repositories, {
    clinicId,
    patientId,
    currency: charge.currency,
    charges: [charge],
    invoiceId: billing.newInvoiceId(),
    issuedAt: clock.now(),
    status: 'ISSUED',
  });
}

async function raisePlanItemCharge(
  clinicId: ClinicId,
  patientId: PatientId,
  item: TreatmentPlanItemSummary,
  repositories: Pick<Repositories, 'charges' | 'clinics'>,
  clock: Clock,
  billing: CompleteTreatmentPlanItemBillingDependencies,
): Promise<Charge | null> {
  // A zero estimate is a plan line without a price, not a free bill: issuing an
  // invoice for nothing would add a document that says the patient owes nothing.
  if (item.estimatedPriceMinor <= 0) {
    return null;
  }

  const clinic = await repositories.clinics.findById(clinicId);

  if (!clinic) {
    throw notFound('Clinic', clinicId);
  }

  const charge: Charge = {
    id: billing.newChargeId(),
    clinicId,
    patientId,
    visitId: billing.visitId ?? item.sessions.at(-1)?.visitId ?? null,
    treatmentId: item.treatmentId,
    treatmentPlanItemId: item.id,
    description: describePlanItem(item),
    quantity: 1,
    unitPriceMinor: item.estimatedPriceMinor,
    discountMinor: 0,
    taxRatePercent: 0,
    currency: clinic.currency,
    invoiceId: null,
    invoicedAt: null,
    createdAt: clock.now(),
  };

  await repositories.charges.save(charge);

  return charge;
}

function describePlanItem(item: TreatmentPlanItemSummary): string {
  const treatment =
    item.treatmentName?.trim() || item.treatmentCode?.trim() || 'Treatment plan item';
  const tooth = item.tooth ? ` · ${item.tooth}` : '';
  const quantity = item.quantity > 1 ? ` × ${item.quantity}` : '';
  return `${treatment}${tooth}${quantity}`.slice(0, 200);
}
