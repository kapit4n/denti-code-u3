/**
 * The dashboard, in a real browser, against a mocked API.
 *
 * The exit criterion for Milestone 3 is that every figure is computed by the API
 * and shown as the API returned it. That makes two things worth pinning down,
 * and this file pins down both:
 *
 *  1. the figures on screen match the payload — no client-side arithmetic that
 *     could drift away from the server's;
 *  2. an *unknown* figure is presented as unknown. `occupancyRate: null` must
 *     render as an em dash, not as `0%`, which would tell the clinic nobody is
 *     working today when in fact the API simply could not tell.
 *
 * The API's own timezone arithmetic is not re-tested here — it is covered by
 * `apps/api/src/application/clinic-time-window.test.ts` (9 cases across
 * offsets and DST) and by the dashboard integration test. Re-deriving a calendar
 * window in the browser to assert it would test the spec, not the app.
 */

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import {
  ANA_ID,
  allDashboardFixtures,
  clinicFixture,
  dashboardStats,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, installApiFailure } from './fixtures/mock-api.js';

/**
 * The card whose heading is `title`.
 *
 * `CardTitle` is an `h3`, so the heading is addressable by role; its parent is the
 * card header and its grandparent the card itself, which is the element that
 * contains the rows. If the card layout changes, this locator stops resolving and
 * one spec fails loudly — which is the trade for not reaching into class names.
 */
function cardTitled(page: Page, title: string): Locator {
  return page.getByRole('heading', { name: title, exact: true }).locator('xpath=../..');
}

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // The dashboard's own five endpoints, plus the clinic's settings: "New Visit" opens
    // a booking dialog, and the dialog cannot be opened without knowing the clinic's
    // timezone. A spec that mocks only the five gets a 501 from the mock, by design.
    await installApi(page, { ...allDashboardFixtures(), ...clinicFixture() });
  });

  test('renders the payload verbatim', async ({ page }) => {
    await page.goto('/dashboard');

    // The page's <h1> is a time-of-day greeting, so it is not a usable anchor —
    // it changes between morning and evening runs. The stat grid is.
    await expect(page.getByRole('region', { name: 'Clinic statistics' })).toBeVisible();

    // Targeted by test id rather than by text position: the grid order is a
    // layout decision that should not be able to break a spec.
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveText('3');
    await expect(page.getByTestId('stat-card-value-Completed')).toHaveText('0');
    await expect(page.getByTestId('stat-card-value-Pending')).toHaveText('2');
    await expect(page.getByTestId('stat-card-value-In treatment')).toHaveText('1');
    await expect(page.getByTestId('stat-card-value-Active patients')).toHaveText('2');
    await expect(page.getByTestId('stat-card-value-Pending treatments')).toHaveText('2');

    // 8000 minor units must read as 80.00 — the conversion belongs to
    // `formatMinorUnits`, never to a `/ 100` in the component.
    await expect(page.getByTestId('stat-card-value-Collected this month')).toHaveText('80.00 USD');
  });

  test('distinguishes an unknown metric from a zero one', async ({ page }) => {
    await page.goto('/dashboard');

    // `occupancyRate` is `null` in the fixture. Asserting `—` and asserting the
    // absence of `0%` together: the first could pass with the wrong label, the
    // second catches a component that "helpfully" defaulted it.
    await expect(page.getByTestId('stat-card-value-Occupancy')).toHaveText('—');
    await expect(page.getByText('0%')).toHaveCount(0);

    // `completed` really is 0, and must still render as 0. Flattening "unknown"
    // into zero in either direction loses information the clinic needs.
    await expect(page.getByTestId('stat-card-value-Completed')).toHaveText('0');
  });

  test('shows an occupancy percentage when the API does know one', async ({ page }) => {
    await installApi(page, {
      ...allDashboardFixtures(),
      '/api/v1/dashboard/stats': {
        body: {
          ...dashboardStats,
          clinic: { ...dashboardStats.clinic, occupancyRate: 42 },
        },
      },
    });

    await page.goto('/dashboard');

    await expect(page.getByTestId('stat-card-value-Occupancy')).toHaveText('42%');
  });

  test('lists today’s appointments with their patient names', async ({ page }) => {
    await page.goto('/dashboard');

    // Scoped to the card, because "Ana García" also appears in Recent Patients —
    // a page-wide text match would pass even if the appointments panel were
    // empty.
    const appointments = cardTitled(page, "Today's Appointments");
    await expect(appointments.getByText(/Ana García/)).toBeVisible();
    await expect(appointments.getByText(/Luis Fernández/)).toBeVisible();
    // Both rows, and only those two.
    await expect(appointments.getByRole('listitem')).toHaveCount(2);
    // Status text comes straight from the payload and is unique to this panel.
    await expect(appointments.getByText(/CONFIRMED/)).toBeVisible();
  });

  test('says so plainly when the day has no appointments', async ({ page }) => {
    await installApi(page, {
      ...allDashboardFixtures(),
      '/api/v1/dashboard/today-appointments': { body: { items: [] } },
    });

    await page.goto('/dashboard');

    // An empty state, not an empty box: a silent blank panel reads as a bug
    // report from the front desk.
    await expect(page.getByText('No appointments scheduled for today.')).toBeVisible();
  });

  test('marks a metric as unavailable instead of showing a zero', async ({ page }) => {
    await installApiFailure(page);

    await page.goto('/dashboard');

    // A failed metric and a genuine zero are different facts. Rendering 0 after a
    // 500 would let the clinic make a staffing decision on bad data. The error
    // branch is asserted via its own test id: there is deliberately no
    // `stat-card-value-*` element while a card is in error, so nothing on the
    // page can present a number the API never sent.
    //
    // This spec cannot tell an injected 500 from a wrong base URL — both put the
    // card in its error state. That is fine, because it is not what it is for:
    // the eight data-bearing specs in this file are what catch a base URL, and
    // all of them fail when the prefix is dropped.
    await expect(page.getByTestId('stat-card-error-Appointments')).toHaveText('Unavailable');
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveCount(0);
  });

  test('links a recent patient straight to their profile', async ({ page }) => {
    await page.goto('/dashboard');

    const ana = page.getByRole('link', { name: /Ana García/ }).first();
    await ana.click();

    await expect(page).toHaveURL(new RegExp(`/patients/${ANA_ID}$`));
  });

  test('renders one bar per day that has bookings', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByText('Calendar Preview', { exact: true })).toBeVisible();

    // The fixture has bookings on the 3rd and the 6th only, so two bars — not
    // fourteen. A preview that drew an empty day as a zero-height bar would
    // look like a chart of a very quiet fortnight.
    const bars = page.locator('li[title*="bookings"]');
    await expect(bars).toHaveCount(2);
    await expect(bars.first()).toHaveAttribute('title', '2026-10-03: 2 bookings, 0 completed');
    await expect(bars.last()).toHaveAttribute('title', '2026-10-06: 1 bookings, 0 completed');
  });

  test('has no console errors on a normal load', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await page.goto('/dashboard');
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveText('3');

    expect(errors).toEqual([]);
  });
});
