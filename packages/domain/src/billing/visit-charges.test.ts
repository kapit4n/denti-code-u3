/**
 * `addVisitCharge` and `listVisitCharges` — the charges on a visit.
 *
 * What is worth testing is the decisions the file makes, which would otherwise be
 * discovered as bugs:
 *
 *  - **The visit is read before anything else, in both directions.** A charge for
 *    another clinic's visit is `NOT_FOUND` on write, and on the read side the visit
 *    read is the only thing standing between a foreign visit and an answer of `[]`,
 *    which reads as "nothing was charged" (ADR 0014).
 *  - **Who and what the row names is inherited or owned, never restated.**
 *    `patientId` and `visitId` come from the visit, and the currency comes from the
 *    clinic — the one thing a price is denominated in that neither the request nor
 *    the visit can say. The request carries only the description and the price.
 *  - **A charge has to actually say something and be priced within the law of
 *    arithmetic.** A blank description writes nothing; a quantity of zero, a
 *    negative price and a negative discount are refusals, not values a row can hold.
 *
 * The clock and the id generator are asserted rather than trusted, for the same
 * reason `visit-prescriptions.test.ts` asserts them: an entity stamped by the
 * repository is an entity the use case cannot testify about.
 */

import { describe, expect, it } from 'vitest';

import {
  asChargeId,
  asClinicId,
  asPatientId,
  asTreatmentId,
  asTreatmentPlanId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type PatientId,
  type TreatmentId,
  type VisitId,
} from '@denti-code-u3/types';
import type {
  ChargeRepository,
  ClinicRepository,
  TreatmentPlanRepository,
  TreatmentPlanSummary,
  VisitRepository,
} from '../ports/index.js';
import type { Clinic } from '../organization/index.js';
import type { Visit } from '../visit/index.js';
import type { Charge } from './invoice.js';
import { addVisitCharge, listVisitCharges } from './visit-charges.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const VISIT = asVisitId('33333333-3333-4333-8333-333333333333');
const CHARGE = asChargeId('77777777-7777-4777-8777-777777777777');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;
const TREATMENT_ID = asTreatmentId('99999999-9999-4999-8999-999999999999');
const PLAN_ITEM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/**
 * One plan with one open item, the shape `listForPatient` answers with. A test can
 * override the item's treatment to prove the fold, or leave the item id unmatched to
 * prove the scope.
 */
function aPlan(overrides: { treatmentId?: TreatmentId | null } = {}): TreatmentPlanSummary {
  return {
    id: asTreatmentPlanId('55555555-7777-4777-8777-777777777777'),
    dentistId: null,
    status: 'ACCEPTED',
    title: 'Restorative plan',
    notes: null,
    presentedAt: null,
    acceptedAt: null,
    updatedAt: NOW,
    items: [
      {
        id: PLAN_ITEM,
        treatmentId: overrides.treatmentId === undefined ? TREATMENT_ID : overrides.treatmentId,
        treatmentCode: 'RES-01',
        treatmentName: 'Composite restoration',
        tooth: '16',
        surfaces: [],
        quantity: 1,
        estimatedPriceMinor: 20_000,
        isCompleted: false,
        completedAt: null,
        notes: null,
      },
    ],
    progress: { total: 1, completed: 0, inProgress: 0, pending: 1, percentComplete: 0 },
  };
}

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

/** What the fakes recorded, so a test can assert on the calls and not only the answers. */
interface Recorded {
  saved: Charge[];
  reads: { clinicId: ClinicId; visitId: VisitId }[];
  /** Every `listForPatient` the use case made while resolving a named plan item. */
  planReads: {
    clinicId: ClinicId;
    patientId: Parameters<TreatmentPlanRepository['listForPatient']>[1];
  }[];
}

/**
 * `visit: undefined` means *no such visit*, chosen with `in` rather than `??` for the
 * reason `visit-prescriptions.test.ts` gives: "the visit does not exist" and "the
 * visit is open" must not be the same fixture.
 *
 * `plans` is what `listForPatient` answers: a plan item is resolved by walking the
 * patient's own plans, so an empty list is "the patient has no plans to name".
 */
function harness(
  options: {
    visit?: Visit;
    clinic?: Clinic;
    stored?: readonly Charge[];
    plans?: readonly TreatmentPlanSummary[];
  } = {},
) {
  const recorded: Recorded = { saved: [], reads: [], planReads: [] };

  const storedVisit: Visit | undefined = 'visit' in options ? options.visit : openVisit();
  const storedClinic: Clinic | undefined = 'clinic' in options ? options.clinic : aClinic();
  const storedPlans = options.plans ?? [];

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
      recorded.reads.push({ clinicId, visitId });
      return options.stored ?? [];
    },
    save: async (charge) => {
      recorded.saved.push(charge);
    },
    markInvoiced: async () => {},
  };

  return {
    recorded,
    dependencies: {
      visits,
      clinics,
      charges,
      treatmentPlans: {
        listForPatient: async (clinicId: ClinicId, patientId: PatientId) => {
          recorded.planReads.push({ clinicId, patientId });
          return storedPlans;
        },
      },
      clock: { now: () => NOW },
      newId: () => CHARGE,
    },
  };
}

describe('addVisitCharge', () => {
  it('writes the charge the visit and the clinic own, stamped by the clock and the generator', async () => {
    const { recorded, dependencies } = harness();

    const charge = await addVisitCharge(
      CLINIC,
      VISIT,
      {
        description: '  Composite restoration, tooth 16  ',
        quantity: 2,
        unitPriceMinor: 12_000,
        discountMinor: 1_000,
      },
      dependencies,
    );

    expect(charge).toEqual({
      id: CHARGE,
      // The clinic is the request's, and the patient and the visit are the visit's.
      clinicId: CLINIC,
      patientId: PATIENT,
      visitId: VISIT,
      // A charge recorded by hand names no catalogue treatment.
      treatmentId: null,
      // ...and bills no planned line.
      treatmentPlanItemId: null,
      description: 'Composite restoration, tooth 16',
      quantity: 2,
      unitPriceMinor: 12_000,
      discountMinor: 1_000,
      // No tax in this slice (OPEN QUESTION), and the charge is not yet invoiced.
      taxRatePercent: 0,
      invoiceId: null,
      invoicedAt: null,
      // The currency is the clinic's, not anything the request could have said.
      currency: 'PEN',
      createdAt: NOW,
    });
    // The use case's answer and the row it wrote are the same object; a repository
    // that re-derived either would put two accounts of one charge in the world.
    expect(recorded.saved).toEqual([charge]);
  });

  it('defaults the quantity and the discount when the caller omits them', async () => {
    const { recorded, dependencies } = harness();

    const charge = await addVisitCharge(
      CLINIC,
      VISIT,
      { description: 'Scaling and prophylaxis', unitPriceMinor: 4_500 },
      dependencies,
    );

    expect(charge.quantity).toBe(1);
    expect(charge.discountMinor).toBe(0);
    expect(recorded.saved.at(-1)!.quantity).toBe(1);
    expect(recorded.saved.at(-1)!.discountMinor).toBe(0);
  });

  it('prices the charge in the clinic’s own currency, whatever the caller’s numbers say', async () => {
    const { recorded, dependencies } = harness({ clinic: aClinic({ currency: 'USD' }) });

    const charge = await addVisitCharge(
      CLINIC,
      VISIT,
      { description: 'Cleaning', unitPriceMinor: 8_000 },
      dependencies,
    );

    expect(charge.currency).toBe('USD');
    expect(recorded.saved.at(-1)!.currency).toBe('USD');
  });

  it('refuses a blank description and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitCharge(CLINIC, VISIT, { description: '   ', unitPriceMinor: 5_000 }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a description longer than 200 characters', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitCharge(
        CLINIC,
        VISIT,
        { description: 'x'.repeat(201), unitPriceMinor: 5_000 },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity])('refuses a quantity of %s', async (quantity) => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitCharge(
        CLINIC,
        VISIT,
        { description: 'Cleaning', quantity, unitPriceMinor: 5_000 },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it.each([-100, 10.5])('refuses a unit price of %s', async (unitPriceMinor) => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitCharge(CLINIC, VISIT, { description: 'Cleaning', unitPriceMinor }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a negative discount', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      addVisitCharge(
        CLINIC,
        VISIT,
        { description: 'Cleaning', unitPriceMinor: 5_000, discountMinor: -1 },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND for a visit another clinic holds, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    // The visit exists and this clinic does not hold it. Saying which of those two
    // was wrong would confirm the id is real somewhere else (ADR 0014).
    await expect(
      addVisitCharge(
        OTHER_CLINIC,
        VISIT,
        { description: 'Cleaning', unitPriceMinor: 5_000 },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND when the visit does not exist at all', async () => {
    const { recorded, dependencies } = harness({ visit: undefined });

    await expect(
      addVisitCharge(
        CLINIC,
        VISIT,
        { description: 'Cleaning', unitPriceMinor: 5_000 },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND when the visit proves the clinic exists but the clinic has since gone', async () => {
    const { recorded, dependencies } = harness({ clinic: undefined });

    await expect(
      addVisitCharge(
        CLINIC,
        VISIT,
        { description: 'Cleaning', unitPriceMinor: 5_000 },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  /**
   * The plan-item link — provenance, the same decision the recorded treatment made.
   *
   * Naming a planned line says *which* line the money is for; it never completes the
   * line. The item is resolved on the patient's own plan (`listForPatient`), and its
   * own treatment is folded into the charge so the bill reads without joining back —
   * so the fold is asserted, not merely the id.
   */
  describe('the plan-item link', () => {
    it('bills the named planned item and folds its catalogue treatment into the charge', async () => {
      const { recorded, dependencies } = harness({ plans: [aPlan()] });

      const charge = await addVisitCharge(
        CLINIC,
        VISIT,
        {
          description: 'Composite restoration',
          unitPriceMinor: 20_000,
          treatmentPlanItemId: PLAN_ITEM,
        },
        dependencies,
      );

      expect(charge.treatmentPlanItemId).toBe(PLAN_ITEM);
      // The fold: the item's own treatment becomes the charge's, so the bill names
      // what was done without reading the plan back.
      expect(charge.treatmentId).toBe(TREATMENT_ID);
      expect(recorded.saved).toEqual([charge]);
      // Scoped to this clinic and the visit's own patient, never the caller's word.
      expect(recorded.planReads).toEqual([{ clinicId: CLINIC, patientId: PATIENT }]);
    });

    it('links the item but folds a null treatment when the planned line names no catalogue entry', async () => {
      const { recorded, dependencies } = harness({ plans: [aPlan({ treatmentId: null })] });

      const charge = await addVisitCharge(
        CLINIC,
        VISIT,
        {
          description: 'Manual restoration',
          unitPriceMinor: 20_000,
          treatmentPlanItemId: PLAN_ITEM,
        },
        dependencies,
      );

      // An item may be described rather than coded; the link still holds.
      expect(charge.treatmentPlanItemId).toBe(PLAN_ITEM);
      expect(charge.treatmentId).toBeNull();
      expect(recorded.saved.at(-1)!.treatmentPlanItemId).toBe(PLAN_ITEM);
    });

    it('refuses a plan item that is not on the patient’s plan, and writes nothing', async () => {
      const { recorded, dependencies } = harness({ plans: [aPlan()] });

      await expect(
        addVisitCharge(
          CLINIC,
          VISIT,
          {
            description: 'Composite restoration',
            unitPriceMinor: 20_000,
            treatmentPlanItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(recorded.saved).toEqual([]);
      // The plan *was* read: the refusal is the lookup's finding, not a skipped check.
      expect(recorded.planReads).toEqual([{ clinicId: CLINIC, patientId: PATIENT }]);
    });

    it('refuses a named plan item when the patient has no plans at all', async () => {
      const { recorded, dependencies } = harness({ plans: [] });

      await expect(
        addVisitCharge(
          CLINIC,
          VISIT,
          {
            description: 'Composite restoration',
            unitPriceMinor: 20_000,
            treatmentPlanItemId: PLAN_ITEM,
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(recorded.saved).toEqual([]);
      expect(recorded.planReads).toEqual([{ clinicId: CLINIC, patientId: PATIENT }]);
    });

    it('drops a blank plan item to null without reading the patient’s plans', async () => {
      const { recorded, dependencies } = harness({ plans: [aPlan()] });

      const charge = await addVisitCharge(
        CLINIC,
        VISIT,
        { description: 'Cleaning', unitPriceMinor: 5_000, treatmentPlanItemId: '   ' },
        dependencies,
      );

      expect(charge.treatmentPlanItemId).toBeNull();
      expect(charge.treatmentId).toBeNull();
      // The dependency is only paid for when the caller actually names an item.
      expect(recorded.planReads).toEqual([]);
    });
  });
});

describe('listVisitCharges', () => {
  it('returns the charges the repository holds, and asks it about this clinic’s visit', async () => {
    const held = [aCharge(), aCharge({ id: asChargeId('88888888-8888-4888-8888-888888888888') })];
    const { recorded, dependencies } = harness({ stored: held });

    const list = await listVisitCharges(CLINIC, VISIT, dependencies);

    // The list itself is the repository's, ordering included; what the use case owes
    // is the scoping, so that is what the read is asserted with.
    expect(list).toEqual(held);
    expect(recorded.reads).toEqual([{ clinicId: CLINIC, visitId: VISIT }]);
  });

  it('answers NOT_FOUND for a visit this clinic does not hold, never an empty list', async () => {
    const { recorded, dependencies } = harness();

    // An empty answer here would read as "nothing was charged", which is a
    // different claim from "this clinic cannot see this visit" (ADR 0014).
    await expect(listVisitCharges(OTHER_CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(recorded.reads).toEqual([]);
  });

  it('answers NOT_FOUND for a visit that does not exist', async () => {
    const { dependencies } = harness({ visit: undefined });

    await expect(listVisitCharges(CLINIC, VISIT, dependencies)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
