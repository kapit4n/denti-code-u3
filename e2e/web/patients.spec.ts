/**
 * Patient list and profile, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * one question only: **does the app present a patient correctly?** The API's own
 * behaviour is covered by `apps/api/test/patient-profile-scope.integration.test.ts`
 * against real PostgreSQL.
 *
 * Every test here maps onto a defect that reached production code during
 * Milestone 4 while the unit suite, typecheck, lint and build were all green.
 * That is the reason these exist: those failures produced plausible-looking
 * pages rather than errors, so nothing short of rendering the thing caught them.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  LUIS_ID,
  PATIENT_LIST_RESPONSE,
  anaProfile,
  clinicFixture,
  luisProfile,
  patientSummaries,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, installApiFailure, notFound } from './fixtures/mock-api.js';

const LIST_PATH = '/api/v1/patients';

test.describe('Patient list', () => {
  test('renders a row per patient, with the inactive one marked', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, { [LIST_PATH]: { body: PATIENT_LIST_RESPONSE } });

    await page.goto('/patients');

    await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
    // A list that renders only the first row is the bug that `const [[row]] =
    // await Promise.all(...)` produced. Assert all three, not a count.
    await expect(page.getByRole('link', { name: /Luis Fernández/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ana García/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sofía Ramírez/ })).toBeVisible();

    await expect(page.getByRole('link', { name: /Ana García/ })).toContainText('P-000001');
    await expect(page.getByRole('link', { name: /Sofía Ramírez/ })).toContainText('Inactive');

    expect(errors).toEqual([]);
  });

  test('sends the debounced search query to the server', async ({ page }) => {
    const api = await installApi(page, {
      [LIST_PATH]: {
        body: {
          items: [patientSummaries[1]!],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      },
    });

    await page.goto('/patients');
    await page.getByPlaceholder('Search by name or record number…').fill('gar');

    // Polled rather than awaited once: `waitForRequest` resolves on the request
    // event, which fires *before* the route handler records the URL, so reading
    // the log immediately afterwards is a race. Polling also states the
    // debounce honestly — the request is expected slightly late, not never.
    //
    // The query must reach the server; filtering in the browser after fetching
    // everything would be a different product and a different performance
    // profile.
    await expect
      .poll(() => api.requests.map((url) => new URL(url).searchParams.get('q')))
      .toContain('gar');

    // The first request, before any typing, must carry no query at all. Sending
    // `q=` would make "no search" and "empty search" two different cache keys for
    // the same list.
    expect(api.requests[0]).not.toContain('q=');
  });

  test('shows an explicit alert when the list cannot be loaded', async ({ page }) => {
    await installApiFailure(page);

    await page.goto('/patients');

    // The failure must be visible. Falling back to an empty list would be
    // indistinguishable from "this clinic has no patients".
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
  });

  test('says so when a search matches nothing', async ({ page }) => {
    await installApi(page, {
      [LIST_PATH]: {
        body: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      },
    });

    await page.goto('/patients');
    await page.getByPlaceholder('Search by name or record number…').fill('zzzz');

    await expect(page.getByText(/No patient matches/)).toBeVisible();
  });
});

test.describe('Patient profile', () => {
  test('shows a full record, not the list again', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [`${LIST_PATH}/${ANA_ID}`]: { body: anaProfile },
      [LIST_PATH]: { body: PATIENT_LIST_RESPONSE },
    });

    await page.goto(`/patients/${ANA_ID}`);

    // Regression for the flat-route fix: `patients.tsx` has no <Outlet />, so a
    // nested `patients.$patientId` route silently rendered the list here.
    await expect(page.getByRole('heading', { name: /Ana García/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sofía Ramírez/ })).toHaveCount(0);

    await expect(page.getByText('Penicillin')).toBeVisible();
    await expect(page.getByText('65.00 USD')).toBeVisible();
    await expect(page.getByText('Sensitivity in the upper right quadrant')).toBeVisible();
    await expect(page.getByText(/Restorative plan/)).toBeVisible();
    await expect(page.getByText('ana.garcia@example.test')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('renders empty collections instead of crashing on them', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...clinicFixture(),
      [`${LIST_PATH}/${LUIS_ID}`]: { body: luisProfile },
    });

    await page.goto(`/patients/${LUIS_ID}`);

    // The defect this pins down: an empty result was destructured into
    // `undefined`, so `recentVisits.length` threw and React unmounted the whole
    // route. Empty arrays must render as text, not as a crash.
    await expect(page.getByText('No visits recorded.')).toBeVisible();
    await expect(page.getByText('Nothing booked.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Luis Fernández/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('labels a negative balance as credit rather than as debt', async ({ page }) => {
    await installApi(page, {
      ...clinicFixture(),
      [`${LIST_PATH}/${LUIS_ID}`]: { body: luisProfile },
    });

    await page.goto(`/patients/${LUIS_ID}`);

    // Luis prepaid 80.00. Rendering "-80.00 USD" would state the opposite of
    // what happened, so the word matters as much as the number.
    await expect(page.getByText('Credit 80.00 USD')).toBeVisible();
    await expect(page.getByText('-80.00 USD')).toHaveCount(0);
  });

  test('reports a missing patient instead of rendering an empty shell', async ({ page }) => {
    await installApi(page, { [`${LIST_PATH}/${ANA_ID}`]: notFound() });

    await page.goto(`/patients/${ANA_ID}`);

    await expect(page.getByRole('alert')).toBeVisible();
  });
});

test.describe('Global patient search', () => {
  test('is reachable from the header and navigates to the profile', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      [LIST_PATH]: {
        body: { items: [anaProfile], pagination: { page: 1, limit: 8, total: 1, totalPages: 1 } },
      },
      // Needed as well as the list: landing on the profile fires the detail
      // query, and an unmocked endpoint answers 501 by design. So does the
      // clinic's settings, which the profile now reads its times through.
      ...clinicFixture(),
      [`${LIST_PATH}/${ANA_ID}`]: { body: anaProfile },
    });

    await page.goto('/');

    // Regression for the dead search box: the component existed, was tested, and
    // was never mounted. Asserting it exists in the shell is the whole point.
    const search = page.getByRole('combobox');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('placeholder', 'Search patients…');

    await search.fill('ana');
    const option = page.getByRole('option', { name: /Ana García/ });
    await expect(option).toBeVisible();
    await option.click();

    await expect(page).toHaveURL(new RegExp(`/patients/${ANA_ID}$`));
    await expect(page.getByText('Penicillin')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('does not query the API before the user types', async ({ page }) => {
    const api = await installApi(page, {
      [LIST_PATH]: { body: PATIENT_LIST_RESPONSE },
    });

    await page.goto('/');
    await expect(page.getByRole('combobox')).toBeVisible();
    // Give any stray request time to appear before claiming there were none.
    await page.waitForTimeout(500);

    expect(api.requests).toEqual([]);
  });
});
