/**
 * The patient's treatment plans, on the profile, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * presentation questions only: does the card draw what the API returned — with
 * the API's own progress block rather than a count of its own — does a proposed
 * plan or a completed line reach the screen only once a refetch has produced it,
 * and are "nothing has been offered", "the read failed" and "the write was
 * refused" different sentences?
 *
 * What the API decides — which plans a patient has, what a foreign patient
 * answers, which statuses a move may reach — is the API's subject, covered against
 * real databases in `apps/api/test/patient-profile-scope.integration.test.ts` and
 * `sqlite-smoke.integration.test.ts`.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaBalance,
  anaOdontogram,
  anaProfile,
  anaTreatmentPlans,
  clinicFixture,
  createdTreatmentPlan,
  noInvoices,
  noTreatmentPlans,
  TREATMENT_CATALOGUE_ID,
  treatmentsCatalogue,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, type InstalledApi, type RecordedRequest } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const PLANS_PATH = `${PROFILE_PATH}/treatment-plans`;
const INVOICES_PATH = `${PROFILE_PATH}/invoices`;
const BALANCE_PATH = `${PROFILE_PATH}/balance`;

const PLAN_ID = anaTreatmentPlans.items[0].id;
const PENDING_ITEM_ID = anaTreatmentPlans.items[0].items[1].id;

/**
 * The console-error list, minus the browser's own note about a refused response.
 *
 * The refusal spec makes the API answer 422, and Chromium logs that as a console
 * error before the application has had any chance to react — so the raw list is
 * never empty there. What is left after the filter is what must not happen: an
 * uncaught exception or an error the application itself printed.
 */
function expectedResourceFailures(errors: readonly string[]): string[] {
  return errors.filter((text) => !text.startsWith('Failed to load resource'));
}

/** How many times the plans list was read (the writes are different methods). */
function planReads(recorded: readonly RecordedRequest[]): number {
  return recorded.filter(
    (entry) => entry.method === 'GET' && new URL(entry.url).pathname === PLANS_PATH,
  ).length;
}

/** The plan body sent to the server, or `undefined` when nothing was sent. */
function writtenPlan(api: InstalledApi): unknown {
  return api.recorded.find(
    (request) => request.method === 'POST' && new URL(request.url).pathname === PLANS_PATH,
  )?.body;
}

/** The "mark done" request for the pending line, or `undefined` when none was sent. */
function completionRequest(recorded: readonly RecordedRequest[]): RecordedRequest | undefined {
  return recorded.find(
    (request) =>
      request.method === 'POST' && request.url.endsWith(`/items/${PENDING_ITEM_ID}/complete`),
  );
}

/** The plans list as it reads after the pending line was marked done. */
const plansAfterCompletion = {
  items: anaTreatmentPlans.items.map((plan) => ({
    ...plan,
    items: plan.items.map((item) =>
      item.id === PENDING_ITEM_ID
        ? { ...item, isCompleted: true, completedAt: '2026-10-07T10:05:00.000Z' }
        : item,
    ),
    progress: { total: 2, completed: 2, inProgress: 0, pending: 0, percentComplete: 100 },
  })),
};

test.describe('Treatment plans on the profile', () => {
  test('draws the plan, the server’s progress and its items', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [PLANS_PATH]: { body: anaTreatmentPlans },
      [INVOICES_PATH]: { body: noInvoices },
      [BALANCE_PATH]: { body: anaBalance },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const plan = page.getByTestId('patient-treatment-plan');
    await expect(plan).toContainText('Restorative plan');
    await expect(plan).toContainText('ACCEPTED');

    // The progress is the projection the API computed from the rows: 1 of 2, 50%.
    // A card that counted the list would have to disagree with the endpoint to be
    // wrong, and neither would throw.
    await expect(page.getByTestId('plan-progress')).toContainText('2 items · 1 complete · 50%');

    const items = page.getByTestId('patient-treatment-plan-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Tooth 26 · Composite restoration — anterior');
    await expect(items.nth(0)).toContainText('300.00');
    // The second item's treatment carries no code, so a card that fell back to
    // the code when the name was null has nothing to fall back to here.
    await expect(items.nth(1)).toContainText('Tooth 36 · Scaling and prophylaxis');
    await expect(items.nth(1)).toContainText('0.00');

    expect(errors).toEqual([]);
  });

  test('says nothing has been offered, rather than failing quietly', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [PLANS_PATH]: { body: noTreatmentPlans },
      [INVOICES_PATH]: { body: noInvoices },
      [BALANCE_PATH]: { body: anaBalance },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await expect(page.getByTestId('patient-treatment-plans')).toContainText(
      'No treatment plans for this patient yet.',
    );
    expect(errors).toEqual([]);
  });

  test('says the read failed instead of showing an empty list', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      // No fixture for the plans path: the mock answers 501 naming it, which is
      // what a missing registration looks like.
    });

    await page.goto(`/patients/${ANA_ID}`);

    const alert = page.getByRole('alert').filter({ hasText: 'treatment plans' });
    await expect(alert).toContainText('The treatment plans could not be loaded.');
    await expect(page.getByTestId('patient-treatment-plans')).not.toContainText(
      'No treatment plans for this patient yet.',
    );

    // The 501 reaches the console as a refused response before the application
    // can react; what must not happen is anything else.
    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('proposes a plan and shows it only once the server has stored it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      '/api/v1/treatments': { body: treatmentsCatalogue },
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [PLANS_PATH]: { body: noTreatmentPlans },
      [INVOICES_PATH]: { body: noInvoices },
      [BALANCE_PATH]: { body: anaBalance },
      [`POST ${PLANS_PATH}`]: { status: 201, body: createdTreatmentPlan },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await page.getByTestId('new-plan-open').click();
    await page.getByTestId('new-plan-treatment').click();
    await page.getByRole('option', { name: /COMPO-ANT/ }).click();
    await page.getByTestId('new-plan-tooth').fill('36');
    await page.getByTestId('new-plan-price').fill('120.50');

    // Installed before the write, like the odontogram spec: the refetch the
    // mutation triggers is guaranteed to meet this answer instead of racing a swap
    // that might land after it. The plan that appears carries the server's own id
    // and status, which nothing in the browser could have produced.
    await installApi(page, { [PLANS_PATH]: { body: { items: [createdTreatmentPlan.plan] } } });

    await page.getByTestId('new-plan-submit').click();

    const plan = page.getByTestId('patient-treatment-plan');
    await expect(plan).toContainText('DRAFT');
    await expect(plan).toContainText('Composite restoration — anterior');
    await expect(page.getByTestId('plan-progress')).toContainText('1 item · 0 complete · 0%');

    // The form closes only after the server has answered.
    await expect(page.getByTestId('new-treatment-plan-form')).toHaveCount(0);

    // The body is the composed line and nothing else: the patient is the path, the
    // blank quantity is left out so the server's default of one applies, and the
    // "120.50" the box held travels as the minor units the boundary takes.
    expect(await writtenPlan(api)).toEqual({
      items: [{ treatmentId: TREATMENT_CATALOGUE_ID, tooth: '36', estimatedPriceMinor: 12050 }],
    });

    // Two reads: the section's own, and the one the invalidation asked for.
    await expect.poll(() => planReads(api.recorded)).toBe(2);

    expect(errors).toEqual([]);
  });

  test('keeps the draft when the API refuses the plan', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      '/api/v1/treatments': { body: treatmentsCatalogue },
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [PLANS_PATH]: { body: noTreatmentPlans },
      [INVOICES_PATH]: { body: noInvoices },
      [BALANCE_PATH]: { body: anaBalance },
      [`POST ${PLANS_PATH}`]: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A treatment plan needs at least one item',
            requestId: 'req-plan-1',
          },
        },
      },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await page.getByTestId('new-plan-open').click();
    await page.getByTestId('new-plan-treatment').click();
    await page.getByRole('option', { name: /COMPO-ANT/ }).click();
    await page.getByTestId('new-plan-tooth').fill('36');
    await page.getByTestId('new-plan-submit').click();

    await expect(page.getByTestId('new-plan-error')).toContainText(
      'A treatment plan needs at least one item',
    );

    // The refusal keeps the draft: the typed tooth is still there so the clinician
    // can fix the one thing the API objected to.
    await expect(page.getByTestId('new-treatment-plan-form')).toBeVisible();
    await expect(page.getByTestId('new-plan-tooth')).toHaveValue('36');

    // A refusal does not refetch a list it did not change.
    expect(planReads(api.recorded)).toBe(1);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('marks an item done and redraws from the refetched plan', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [PLANS_PATH]: { body: anaTreatmentPlans },
      [INVOICES_PATH]: { body: noInvoices },
      [BALANCE_PATH]: { body: anaBalance },
      [`POST ${PLANS_PATH}/${PLAN_ID}/items/${PENDING_ITEM_ID}/complete`]: {
        status: 204,
        body: null,
      },
    });

    await page.goto(`/patients/${ANA_ID}`);

    // Only the incomplete line offers the control.
    await expect(page.getByTestId('complete-plan-item')).toHaveCount(1);

    await installApi(page, { [PLANS_PATH]: { body: plansAfterCompletion } });
    await page.getByTestId('complete-plan-item').click();

    // The refetched plan shows the line done and the server's own projection: 2 of
    // 2, 100%.
    await expect(page.getByTestId('plan-progress')).toContainText('2 items · 2 complete · 100%');
    await expect(page.getByTestId('complete-plan-item')).toHaveCount(0);

    // Bodyless: a body the endpoint never reads would let a client believe a field
    // was accepted.
    const completion = completionRequest(api.recorded);
    expect(completion?.method).toBe('POST');
    expect(completion?.body).toBeUndefined();

    expect(errors).toEqual([]);
  });
});
