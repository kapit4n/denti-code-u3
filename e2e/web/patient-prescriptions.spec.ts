/**
 * The patient's prescriptions, and the treatment overview beside them.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so this spec asks what
 * only a browser can answer: does the profile show the courses the patient was
 * given, in the server's order and on the clinic's clock, with a working way back
 * to the visit that issued each one? And does the treatment card name the open
 * work as pending or in progress rather than just listing it?
 *
 * Which lines are open and how many sessions each has is the API's claim, covered
 * against both databases in `apps/api/test/sqlite-smoke.integration.test.ts` and
 * `patient-profile-scope.integration.test.ts`.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  COMPLETED_VISIT_ID,
  VISIT_ID,
  anaBalance,
  anaOdontogram,
  anaPrescriptions,
  anaProfile,
  anaTreatmentPlans,
  clinicFixture,
  noInvoices,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const PRESCRIPTIONS_PATH = `${PROFILE_PATH}/prescriptions`;

test.describe('Patient prescriptions on the profile', () => {
  test('draws the courses newest first, on the clinic clock, linked to their visits', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [`${PROFILE_PATH}/treatment-plans`]: { body: anaTreatmentPlans },
      [`${PROFILE_PATH}/invoices`]: { body: noInvoices },
      [`${PROFILE_PATH}/balance`]: { body: anaBalance },
      [PRESCRIPTIONS_PATH]: { body: anaPrescriptions },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-prescriptions');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Prescriptions' })).toBeVisible();

    const rows = card.getByTestId('patient-prescription');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Amoxicillin · 500 mg');
    await expect(rows.nth(0)).toContainText('Oral · Every 8 hours · 7 days');
    await expect(rows.nth(0)).toContainText('Finish the course.');
    // 13:30Z is 08:30 in Lima, not the browser's America/New_York clock.
    await expect(rows.nth(0)).toContainText('08:30');
    await expect(rows.nth(1)).toContainText('Ibuprofen · 400 mg');
    await expect(rows.nth(1)).toContainText('08:00');

    await expect(rows.nth(0).getByRole('link', { name: 'View visit' })).toHaveAttribute(
      'href',
      `/visits/${VISIT_ID}`,
    );
    await expect(rows.nth(1).getByRole('link', { name: 'View visit' })).toHaveAttribute(
      'href',
      `/visits/${COMPLETED_VISIT_ID}`,
    );
    expect(errors).toEqual([]);
  });

  test('names the open treatment as pending, without hiding the prescriptions', async ({
    page,
  }) => {
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [`${PROFILE_PATH}/treatment-plans`]: { body: anaTreatmentPlans },
      [`${PROFILE_PATH}/invoices`]: { body: noInvoices },
      [`${PROFILE_PATH}/balance`]: { body: anaBalance },
      [PRESCRIPTIONS_PATH]: { body: { prescriptions: [] } },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const overview = page.getByTestId('patient-treatment-overview');
    await expect(overview).toContainText('In progress (0)');
    await expect(overview).toContainText('No treatment is in progress.');
    await expect(overview).toContainText('Pending (1)');
    await expect(overview).toContainText('Tooth 36 · Scaling and prophylaxis');

    await expect(page.getByTestId('patient-prescriptions')).toContainText(
      'No prescriptions recorded for this patient.',
    );
  });
});
