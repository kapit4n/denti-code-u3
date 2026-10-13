/**
 * The patient's treatment plans, on the profile, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * presentation questions only: does the card draw what the API returned — with
 * the API's own progress block rather than a count of its own — and are "nothing
 * has been offered" and "the read failed" different sentences?
 *
 * What the API decides — which plans a patient has, what a foreign patient
 * answers — is the API's subject, covered against real databases in
 * `apps/api/test/patient-profile-scope.integration.test.ts` and
 * `sqlite-smoke.integration.test.ts`.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaOdontogram,
  anaProfile,
  anaTreatmentPlans,
  clinicFixture,
  noTreatmentPlans,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const PLANS_PATH = `${PROFILE_PATH}/treatment-plans`;

test.describe('Treatment plans on the profile', () => {
  test('draws the plan, the server’s progress and its items', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [PLANS_PATH]: { body: anaTreatmentPlans },
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
    expect(errors.filter((text) => !text.startsWith('Failed to load resource'))).toEqual([]);
  });
});
