/**
 * The three treatment-plan writes — `createTreatmentPlan`,
 * `updateTreatmentPlan`, `completeTreatmentPlanItem`.
 *
 * The rules worth testing are the ones each write *owns*:
 *
 *  - the patient (and every named dentist and treatment) is read in this clinic
 *    before anything is written, so a foreign reference is refused, never stored
 *    behind a foreign key (ADR 0014);
 *  - what a client does not state is the server's — the status a new plan opens in,
 *    the item ids, the `presentedAt`/`acceptedAt` stamps, and the blank-to-null and
 *    default rules the rest of the write path keeps;
 *  - a line's tooth is FDI and its surfaces are the odontogram's own enum reduced to
 *    canonical order, judged here rather than trusted from the boundary;
 *  - the completion is idempotent and keeps the first stamp, and an item that is not
 *    the plan's answers 404 rather than a success that changed nothing.
 *
 * The upsert itself is the repository's business and is not retested here: `save` is
 * asserted on the write model it is handed, not on what a database does with it.
 */

import { describe, expect, it } from 'vitest';

import {
  asClinicId,
  asDentistId,
  asPatientId,
  asTreatmentId,
  asTreatmentPlanId,
  type IsoDateTime,
  type TreatmentPlanId,
} from '@denti-code-u3/types';
import type { PatientProfile } from '../patient/index.js';
import type {
  DentistRepository,
  DentistSummary,
  PatientRepository,
  TreatmentCatalogueItem,
  TreatmentPlanRepository,
  TreatmentPlanWriteModel,
  TreatmentRepository,
} from '../ports/index.js';
import { completeTreatmentPlanItem } from './complete-treatment-plan-item.js';
import {
  createTreatmentPlan,
  type CreateTreatmentPlanDependencies,
} from './create-treatment-plan.js';
import { updateTreatmentPlan } from './update-treatment-plan.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const OTHER_CLINIC = asClinicId('66666666-6666-4666-8666-666666666666');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const OTHER_PATIENT = asPatientId('11111111-2222-4222-8222-222222222222');
const DENTIST = asDentistId('33333333-3333-4333-8333-333333333333');
const TREATMENT = asTreatmentId('44444444-4444-4444-8444-444444444444');
const PLAN = asTreatmentPlanId('77777777-7777-4777-8777-777777777777');
const NOW = '2026-10-05T14:30:00.000Z' as IsoDateTime;
const LATER = '2026-10-06T09:00:00.000Z' as IsoDateTime;

function aPatient(): PatientProfile {
  return { id: PATIENT } as PatientProfile;
}

function aDentist(): DentistSummary {
  return { id: DENTIST } as DentistSummary;
}

function aTreatment(): TreatmentCatalogueItem {
  return { id: TREATMENT, code: 'CROWN', name: 'Porcelain crown' } as TreatmentCatalogueItem;
}

interface Recorded {
  saved: TreatmentPlanWriteModel[];
}

/**
 * A fake store that answers the reads the use cases perform and records every save.
 * `plan: undefined` means "no such plan, or not this patient's" — the same answer
 * the real read gives for a plan reached through the wrong patient's path.
 */
function harness(options: { plan?: TreatmentPlanWriteModel; patient?: boolean } = {}) {
  const recorded: Recorded = { saved: [] };
  const patient = options.patient ?? true;
  const plan = 'plan' in options ? options.plan : undefined;

  const patients: Pick<PatientRepository, 'findProfile'> = {
    findProfile: async (clinicId, patientId) =>
      patient && clinicId === CLINIC && patientId === PATIENT ? aPatient() : undefined,
  };

  const dentists: Pick<DentistRepository, 'findById'> = {
    findById: async (clinicId, dentistId) =>
      clinicId === CLINIC && dentistId === DENTIST ? aDentist() : undefined,
  };

  const treatments: Pick<TreatmentRepository, 'findById'> = {
    findById: async (clinicId, treatmentId) =>
      clinicId === CLINIC && treatmentId === TREATMENT ? aTreatment() : undefined,
  };

  const treatmentPlans: Pick<TreatmentPlanRepository, 'save' | 'getForPatient'> = {
    save: async (model) => {
      recorded.saved.push(model);
    },
    getForPatient: async (clinicId, patientId, id) =>
      clinicId === CLINIC && patientId === PATIENT && id === PLAN ? plan : undefined,
  };

  let counter = 0;

  // Wider than `CreateTreatmentPlanDependencies` alone: one harness feeds all
  // three use cases, and the create deps admit only `save`, so the annotation
  // would otherwise erase `getForPatient` that update and complete require.
  const dependencies: CreateTreatmentPlanDependencies & {
    readonly treatmentPlans: Pick<TreatmentPlanRepository, 'save' | 'getForPatient'>;
  } = {
    patients,
    dentists,
    treatments,
    treatmentPlans,
    clock: { now: () => NOW },
    newId: (): TreatmentPlanId => PLAN,
    newItemId: () => `item-${(counter += 1)}`,
  };

  return { recorded, dependencies };
}

function aStoredPlan(overrides: Partial<TreatmentPlanWriteModel> = {}): TreatmentPlanWriteModel {
  return {
    id: PLAN,
    clinicId: CLINIC,
    patientId: PATIENT,
    dentistId: null,
    status: 'DRAFT',
    title: 'Restore the upper right',
    notes: null,
    presentedAt: null,
    acceptedAt: null,
    updatedAt: NOW,
    items: [
      {
        id: 'item-a',
        treatmentId: TREATMENT,
        tooth: '16',
        surfaces: ['MESIAL'],
        quantity: 1,
        estimatedPriceMinor: 45_000,
        isCompleted: false,
        completedAt: null,
        notes: null,
      },
    ],
    ...overrides,
  };
}

describe('createTreatmentPlan', () => {
  it('opens the plan in DRAFT with the clock, folds the treatment labels into the answer, and stores the write model', async () => {
    const { recorded, dependencies } = harness();

    const plan = await createTreatmentPlan(
      CLINIC,
      {
        patientId: PATIENT,
        dentistId: DENTIST,
        title: '  Restore the upper right  ',
        notes: '   ',
        items: [
          {
            treatmentId: TREATMENT,
            tooth: ' 16 ',
            surfaces: ['OCCLUSAL', 'MESIAL', 'MESIAL'],
            estimatedPriceMinor: 45_000,
          },
        ],
      },
      dependencies,
    );

    expect(plan).toMatchObject({
      id: PLAN,
      dentistId: DENTIST,
      status: 'DRAFT',
      title: 'Restore the upper right',
      notes: null,
      presentedAt: null,
      acceptedAt: null,
      updatedAt: NOW,
    });
    expect(plan.items).toEqual([
      {
        id: 'item-1',
        treatmentId: TREATMENT,
        treatmentCode: 'CROWN',
        treatmentName: 'Porcelain crown',
        tooth: '16',
        surfaces: ['MESIAL', 'OCCLUSAL'],
        quantity: 1,
        estimatedPriceMinor: 45_000,
        isCompleted: false,
        completedAt: null,
        notes: null,
      },
    ]);
    expect(plan.progress).toMatchObject({ total: 1, completed: 0, pending: 1, percentComplete: 0 });

    // The stored model is the plan without the joined labels: the write never sends
    // the catalogue back to the table.
    expect(recorded.saved).toHaveLength(1);
    expect(recorded.saved[0]).toMatchObject({
      id: PLAN,
      clinicId: CLINIC,
      patientId: PATIENT,
      status: 'DRAFT',
      title: 'Restore the upper right',
    });
    expect(recorded.saved[0]?.items[0]).toEqual({
      id: 'item-1',
      treatmentId: TREATMENT,
      tooth: '16',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      quantity: 1,
      estimatedPriceMinor: 45_000,
      isCompleted: false,
      completedAt: null,
      notes: null,
    });
  });

  it('leaves a line without a treatment as a note to self, and defaults quantity and price', async () => {
    const { dependencies } = harness();

    const plan = await createTreatmentPlan(
      CLINIC,
      { patientId: PATIENT, items: [{ notes: '  Discuss whitening  ' }] },
      dependencies,
    );

    expect(plan.items[0]).toMatchObject({
      treatmentId: null,
      treatmentCode: null,
      treatmentName: null,
      tooth: null,
      surfaces: [],
      quantity: 1,
      estimatedPriceMinor: 0,
      notes: 'Discuss whitening',
    });
  });

  it('refuses a tooth that is not FDI, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      createTreatmentPlan(CLINIC, { patientId: PATIENT, items: [{ tooth: '99' }] }, dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a surface the domain does not know, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      createTreatmentPlan(
        CLINIC,
        { patientId: PATIENT, items: [{ surfaces: ['MO'] }] },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a treatment this clinic does not offer, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      createTreatmentPlan(
        CLINIC,
        {
          patientId: PATIENT,
          items: [{ treatmentId: asTreatmentId('99999999-9999-4999-8999-999999999999') }],
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('refuses a dentist who is not this clinic’s, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      createTreatmentPlan(
        CLINIC,
        {
          patientId: PATIENT,
          dentistId: asDentistId('99999999-9999-4999-8999-999999999999'),
          items: [{}],
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers NOT_FOUND for a patient this clinic does not hold, and writes nothing', async () => {
    const { recorded, dependencies } = harness();

    await expect(
      createTreatmentPlan(OTHER_CLINIC, { patientId: PATIENT, items: [{}] }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });
});

describe('updateTreatmentPlan', () => {
  it('presents a draft once, stamping presentedAt the first time and never again', async () => {
    const { recorded, dependencies } = harness({ plan: aStoredPlan() });

    await updateTreatmentPlan(CLINIC, PATIENT, PLAN, { status: 'PROPOSED' }, dependencies);
    expect(recorded.saved[0]).toMatchObject({
      status: 'PROPOSED',
      presentedAt: NOW,
      acceptedAt: null,
    });

    const second = harness({
      plan: aStoredPlan({ status: 'PROPOSED', presentedAt: NOW }),
    });
    await updateTreatmentPlan(CLINIC, PATIENT, PLAN, { status: 'PROPOSED' }, second.dependencies);
    expect(second.recorded.saved[0]).toMatchObject({ presentedAt: NOW });
  });

  it('accepts a proposed plan and stamps acceptedAt', async () => {
    const { recorded, dependencies } = harness({
      plan: aStoredPlan({ status: 'PROPOSED', presentedAt: NOW }),
    });

    await updateTreatmentPlan(CLINIC, PATIENT, PLAN, { status: 'ACCEPTED' }, dependencies);

    expect(recorded.saved[0]).toMatchObject({
      status: 'ACCEPTED',
      presentedAt: NOW,
      acceptedAt: NOW,
      updatedAt: NOW,
    });
  });

  it('clears a title with an explicit null and leaves it alone when omitted', async () => {
    const cleared = harness({ plan: aStoredPlan() });
    await updateTreatmentPlan(CLINIC, PATIENT, PLAN, { title: null }, cleared.dependencies);
    expect(cleared.recorded.saved[0]?.title).toBeNull();

    const untouched = harness({ plan: aStoredPlan() });
    await updateTreatmentPlan(CLINIC, PATIENT, PLAN, { notes: 'seen' }, untouched.dependencies);
    expect(untouched.recorded.saved[0]?.title).toBe('Restore the upper right');
    expect(untouched.recorded.saved[0]?.notes).toBe('seen');
  });

  it('carries the plan’s items through the save unchanged', async () => {
    const { recorded, dependencies } = harness({ plan: aStoredPlan() });

    await updateTreatmentPlan(CLINIC, PATIENT, PLAN, { status: 'CANCELLED' }, dependencies);

    expect(recorded.saved[0]?.items).toEqual(aStoredPlan().items);
  });

  it('answers 404 for a plan that is not this patient’s, and writes nothing', async () => {
    const { recorded, dependencies } = harness({ plan: undefined });

    await expect(
      updateTreatmentPlan(CLINIC, PATIENT, PLAN, { status: 'ACCEPTED' }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers 404 for a patient this clinic does not hold, and writes nothing', async () => {
    const { recorded, dependencies } = harness({ patient: false, plan: aStoredPlan() });

    await expect(
      updateTreatmentPlan(CLINIC, PATIENT, PLAN, { status: 'ACCEPTED' }, dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });
});

describe('completeTreatmentPlanItem', () => {
  it('marks the line done with the clock and saves the plan', async () => {
    const { recorded, dependencies } = harness({ plan: aStoredPlan() });

    await completeTreatmentPlanItem(CLINIC, PATIENT, PLAN, 'item-a', dependencies);

    expect(recorded.saved[0]?.items[0]).toMatchObject({ isCompleted: true, completedAt: NOW });
    expect(recorded.saved[0]?.updatedAt).toBe(NOW);
  });

  it('keeps the first stamp when the line is already done, and does not write again', async () => {
    const { recorded, dependencies } = harness({
      plan: aStoredPlan({
        items: [
          {
            id: 'item-a',
            treatmentId: TREATMENT,
            tooth: '16',
            surfaces: ['MESIAL'],
            quantity: 1,
            estimatedPriceMinor: 45_000,
            isCompleted: true,
            completedAt: LATER,
            notes: null,
          },
        ],
      }),
    });

    await completeTreatmentPlanItem(CLINIC, PATIENT, PLAN, 'item-a', dependencies);

    expect(recorded.saved).toEqual([]);
  });

  it('answers 404 for an item that is not this plan’s, and writes nothing', async () => {
    const { recorded, dependencies } = harness({ plan: aStoredPlan() });

    await expect(
      completeTreatmentPlanItem(CLINIC, PATIENT, PLAN, 'item-zzz', dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });

  it('answers 404 for a plan reached through the wrong patient, and writes nothing', async () => {
    const { recorded, dependencies } = harness({ plan: aStoredPlan() });

    await expect(
      completeTreatmentPlanItem(CLINIC, OTHER_PATIENT, PLAN, 'item-a', dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(recorded.saved).toEqual([]);
  });
});
