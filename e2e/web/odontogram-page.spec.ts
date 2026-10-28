/**
 * The clinic-wide odontogram page, in a real browser.
 *
 * The chart's own behaviour is covered by `patient-odontogram.spec.ts`; this spec
 * guards the page's gate — no chart before a patient, the chosen patient's chart
 * after — and the switch that would otherwise leave one patient's teeth on screen
 * under another patient's name.
 *
 * The API is mocked, so the assertions are about what the screen presents: the
 * fixture's CARIES cell, the clinic's clock, and an empty chart for a patient whose
 * rows are empty.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  LUIS_ID,
  PATIENT_LIST_RESPONSE,
  anaOdontogram,
  clinicFixture,
  luisOdontogram,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const ANA_CHART = `/api/v1/patients/${ANA_ID}/odontogram`;
const LUIS_CHART = `/api/v1/patients/${LUIS_ID}/odontogram`;

test.describe('Odontogram page', () => {
  test('asks for a patient before drawing a chart', async ({ page }) => {
    const api = await installApi(page, {
      ...clinicFixture(),
      '/api/v1/patients': { body: PATIENT_LIST_RESPONSE },
      [ANA_CHART]: { body: anaOdontogram },
      [LUIS_CHART]: { body: luisOdontogram },
    });

    await page.goto('/odontogram');

    await expect(page.getByRole('heading', { name: 'Odontogram', exact: true })).toBeVisible();
    await expect(page.getByText('Choose a patient to open their odontogram.')).toBeVisible();
    await expect(page.getByTestId('odontogram-chart')).toHaveCount(0);
    expect(api.recorded.some((request) => request.url.endsWith('/odontogram'))).toBe(false);
  });

  test('draws the chosen patient’s chart and replaces it when the patient changes', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      '/api/v1/patients': { body: PATIENT_LIST_RESPONSE },
      [ANA_CHART]: { body: anaOdontogram },
      [LUIS_CHART]: { body: luisOdontogram },
    });

    await page.goto('/odontogram');

    const picker = page.getByRole('combobox', { name: 'Patient', exact: true });
    await picker.fill('Ana');
    await page.getByRole('option', { name: /Ana García/ }).click();

    await expect(page.getByTestId('odontogram-tooth-16')).toHaveAttribute(
      'data-condition',
      'CARIES',
    );
    await expect(page.getByTestId('odontogram-entry')).toContainText('Tooth 16');
    // 13:00Z is 08:00 in Lima.
    await expect(page.getByTestId('odontogram-entry')).toContainText('08:00');

    await picker.fill('Luis');
    await page.getByRole('option', { name: /Luis Fernández/ }).click();

    await expect(page.getByText('No teeth charted yet.')).toBeVisible();
    await expect(page.getByTestId('odontogram-tooth-16')).toHaveAttribute(
      'data-condition',
      'UNCHARTED',
    );

    expect(
      api.recorded
        .filter((request) => request.method === 'GET')
        .map((request) => new URL(request.url).pathname)
        .filter((path) => path.endsWith('/odontogram')),
    ).toEqual([ANA_CHART, LUIS_CHART]);
    expect(errors).toEqual([]);
  });
});
