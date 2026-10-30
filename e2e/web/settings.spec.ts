/**
 * The clinic settings screen, in a real browser.
 *
 * The API's validation, the domain normalization and both engines' writes are
 * covered by unit and integration tests. These specs answer the browser-only
 * questions: does `/settings` mount, does it prefill all seven days, and does the
 * save send the whole record rather than only the fields that changed?
 */

import { expect, test } from './fixtures/frozen-clock.js';

import { clinicSettings } from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

test.describe('Settings', () => {
  test('prefills the clinic identity and the whole week', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      'GET /api/v1/clinic': { body: clinicSettings },
    });

    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Clinic settings', exact: true })).toBeVisible();
    await expect(page.getByTestId('settings-name')).toHaveValue('Clínica Dental U3');
    await expect(page.getByTestId('settings-legal-name')).toHaveValue('Denti-Code U3 S.A.C.');
    await expect(page.getByTestId('settings-time-zone')).toHaveValue('America/Lima');
    await expect(page.getByTestId('settings-currency')).toHaveValue('PEN');

    await expect(page.getByTestId('settings-hours-row')).toHaveCount(7);
    await expect(page.getByTestId('settings-opens-0')).toHaveValue('08:00');
    await expect(page.getByTestId('settings-closes-5')).toHaveValue('12:00');
    await expect(page.getByTestId('settings-closed-6')).toBeChecked();

    expect(errors).toEqual([]);
  });

  test('saves the identity and the week, and shows the server echo', async ({ page }) => {
    const api = await installApi(page, {
      'GET /api/v1/clinic': { body: clinicSettings },
      'PUT /api/v1/clinic': {
        body: { ...clinicSettings, name: 'Clínica Renovada', currency: 'USD' },
      },
    });

    await page.goto('/settings');
    await expect(page.getByTestId('settings-name')).toHaveValue('Clínica Dental U3');

    await page.getByTestId('settings-name').fill('  Clínica Renovada  ');
    await page.getByTestId('settings-currency').fill('usd');
    await page.getByTestId('settings-address').fill('Av. Nueva 100');
    await page.getByTestId('settings-closed-0').check();
    await page.getByTestId('settings-save').click();

    await expect(page.getByText('Clinic settings saved.')).toBeVisible();

    await expect.poll(() => api.recorded.filter((row) => row.method === 'PUT')).toHaveLength(1);
    const written = api.recorded.find((row) => row.method === 'PUT')?.body;
    expect(written).toMatchObject({
      name: 'Clínica Renovada',
      address: 'Av. Nueva 100',
      timeZone: 'America/Lima',
      currency: 'USD',
    });
    expect((written as { operatingHours: unknown[] }).operatingHours).toHaveLength(7);
    expect(written).toEqual(
      expect.objectContaining({
        operatingHours: expect.arrayContaining([
          expect.objectContaining({ weekday: 1, isClosed: true }),
          expect.objectContaining({ weekday: 7, isClosed: true }),
        ]),
      }),
    );

    await expect(page.getByTestId('settings-name')).toHaveValue('Clínica Renovada');
    await expect(page.getByTestId('settings-currency')).toHaveValue('USD');
  });

  test('keeps the draft and names the permission refusal', async ({ page }) => {
    await installApi(page, {
      'GET /api/v1/clinic': { body: clinicSettings },
      'PUT /api/v1/clinic': {
        status: 403,
        body: {
          error: { code: 'FORBIDDEN', message: 'No', requestId: 'e2e' },
        },
      },
    });

    await page.goto('/settings');
    await page.getByTestId('settings-name').fill('Clínica Nueva');
    await page.getByTestId('settings-save').click();

    await expect(page.getByTestId('settings-failure')).toHaveText(
      'Only an administrator can change clinic settings.',
    );
    await expect(page.getByTestId('settings-name')).toHaveValue('Clínica Nueva');
  });
});
