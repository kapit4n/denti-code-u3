/**
 * Reports, in a real browser.
 *
 * The API's arithmetic is covered by the SQLite smoke and the PostgreSQL route spec.
 * These specs answer the questions only a browser can: does the page present the
 * figures the API returned, does choosing dates and a clinician actually reach the
 * wire, does unassigned production stay visible, and does the export produce a file
 * with the same numbers?
 */

import { readFileSync } from 'node:fs';

import { expect, test } from './fixtures/frozen-clock.js';

import { everyDentistList, reportsFixtures, reportSummary } from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

test.describe('Reports', () => {
  test('draws the period figures and keeps unassigned work visible', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, reportsFixtures());

    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveText('9');
    await expect(page.getByTestId('stat-card-value-Production')).toHaveText('1234.56 PEN');
    await expect(page.getByTestId('stat-card-value-Collections')).toHaveText('900.00 PEN');
    await expect(page.getByTestId('stat-card-value-Outstanding')).toHaveText('334.56 PEN');
    await expect(page.getByTestId('stat-card-value-Occupancy')).toHaveText('18%');

    // The frozen clock is 5 October, so the default period is the clinic month to date.
    await expect(page.getByTestId('report-from')).toHaveValue('2026-10-01');
    await expect(page.getByTestId('report-to')).toHaveValue('2026-10-05');

    const rows = page.getByTestId('report-dentist-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Dra. Rivera');
    await expect(rows.nth(0)).toContainText('1000.00 PEN');
    await expect(rows.nth(1)).toContainText('Unassigned');
    await expect(rows.nth(1)).toContainText('234.56 PEN');

    expect(errors).toEqual([]);
  });

  test('sends the chosen dates and clinician to the API', async ({ page }) => {
    const api = await installApi(page, reportsFixtures());

    await page.goto('/reports');
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveText('9');

    await page.getByTestId('report-from').fill('2026-09-01');
    await page.getByTestId('report-to').fill('2026-09-30');
    await page.getByTestId('report-dentist').selectOption(everyDentistList.items[0].id);

    await expect
      .poll(() => {
        const latest = api.requests.filter((url) => url.includes('/reports/summary')).at(-1);
        return latest ?? '';
      })
      .toContain('from=2026-09-01');

    const requested = api.requests.filter((url) => url.includes('/reports/summary')).at(-1)!;
    expect(requested).toContain('to=2026-09-30');
    expect(requested).toContain(`dentistId=${everyDentistList.items[0].id}`);
  });

  test('renders unknown occupancy as unknown rather than zero', async ({ page }) => {
    await installApi(page, {
      ...reportsFixtures(),
      '/api/v1/reports/summary': {
        body: {
          ...reportSummary,
          occupancy: { bookedMinutes: 0, capacityMinutes: null, rate: null },
        },
      },
    });

    await page.goto('/reports');

    await expect(page.getByTestId('stat-card-value-Occupancy')).toHaveText('—');
    await expect(page.getByText('0%')).toHaveCount(0);
  });

  test('exports a CSV carrying the same figures', async ({ page }) => {
    await installApi(page, reportsFixtures());

    await page.goto('/reports');
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveText('9');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('report-export').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('denti-code-report-2026-10-01_2026-10-05.csv');

    const path = await download.path();
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('Production,1234.56 PEN');
    expect(contents).toContain('Collections,900.00 PEN');
    expect(contents).toContain('Unassigned');
  });
});
