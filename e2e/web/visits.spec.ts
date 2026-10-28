/**
 * The visit directory, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so this answers one
 * question: does the screen present the clinic's visits honestly? The scoping rule
 * itself — a clinician's own rows, the manager's all — belongs to the API and is
 * covered in `apps/api/test/auth.integration.test.ts` on SQLite.
 *
 * The failures this guards against are the plausible ones: a table that leaves out
 * the clinician because the reader is assumed to be one, a time drawn in the
 * visitor's zone, and a page change that never reaches the server.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  VISIT_LIST_RESPONSE,
  allDashboardFixtures,
  clinicFixture,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, installApiFailure } from './fixtures/mock-api.js';

const LIST_PATH = '/api/v1/visits';

test.describe('Visit directory', () => {
  test('renders every visit with its clinician, status and the clinic’s clock', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...allDashboardFixtures(),
      ...clinicFixture(),
      [LIST_PATH]: { body: VISIT_LIST_RESPONSE },
    });

    await page.goto('/visits');

    await expect(page.getByRole('heading', { name: 'Visits', exact: true })).toBeVisible();
    await expect(page.getByText('2 on record')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ana García' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Luis Fernández' })).toBeVisible();

    // The clinician column is not blank for the reader's own rows: this list is
    // shared by the manager, who did not write them.
    await expect(page.getByRole('cell', { name: 'Dra. Rivera' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Unassigned' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Completed' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Open' })).toBeVisible();

    // 14:00Z is 09:00 in Lima. A visitor's zone must not be what is drawn.
    await expect(page.getByText(/09:00/)).toBeVisible();
    await expect(page.getByText(/14:00/)).toHaveCount(0);
    await expect(page.getByText('Not started')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('asks the server for page 2 rather than re-slicing what it has', async ({ page }) => {
    const api = await installApi(page, {
      ...clinicFixture(),
      [LIST_PATH]: {
        body: {
          items: VISIT_LIST_RESPONSE.items,
          pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
        },
      },
    });

    await page.goto('/visits');
    await page.getByRole('button', { name: 'Next' }).click();

    // Polled, because the request event and the recorded URL are not synchronous.
    await expect
      .poll(() => api.requests.map((url) => new URL(url).searchParams.get('page')))
      .toContain('2');
  });

  test('says the record is empty rather than drawing an empty table', async ({ page }) => {
    await installApi(page, {
      ...clinicFixture(),
      [LIST_PATH]: {
        body: {
          items: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      },
    });

    await page.goto('/visits');

    await expect(page.getByText(/No visits on record yet/)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('shows an explicit alert when the list cannot be loaded', async ({ page }) => {
    await installApiFailure(page);
    await page.goto('/visits');

    await expect(page.getByRole('alert')).toHaveText(/visit list could not be loaded/);
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});
