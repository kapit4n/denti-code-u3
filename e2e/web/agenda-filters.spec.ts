/**
 * The agenda's filters, in a real browser, against a mocked API.
 *
 * One claim is worth a browser and it is the one the component tests cannot make:
 * **the narrowing is the server's.** `AgendaFilterBar` and `useAgendaRange` are unit-
 * tested against a stubbed client, which proves they build the right query string and
 * nothing more. What only a real page can show is that the two are wired to each
 * other — that clicking a chip reaches the request the grid sends, that the grid then
 * draws the API's narrower answer, and that the answer is a *different* request rather
 * than a client-side hiding of blocks the browser already had.
 *
 * That last distinction is the whole design. A filter drawn in the browser renders an
 * identical grid today and is wrong the first time the API learns a rule the client has
 * not heard of, and nothing in a screenshot would ever show it. So each assertion here
 * is about a request, not about what is on screen — with one exception, which exists
 * only to prove the redraw actually happened.
 *
 * The rest is deliberately not here: what a chip's markup looks like, which colour a
 * swatch takes, and whether an unvalidated colour is painted. Those are component
 * concerns with component tests, and a browser cannot see the difference between
 * "painted" and "painted with a style attribute that jsdom would have refused".
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  allAgendaFixtures,
  DEPARTED_DENTIST_ID,
  DENTIST_ID,
  emptyAgenda,
} from './fixtures/api-responses.js';
import { installApi } from './fixtures/mock-api.js';

/** The chip row, so a locator cannot wander into the grid. */
function dentists(page: import('@playwright/test').Page) {
  return page.getByRole('group', { name: 'Dentists' });
}

/** Every `/appointments` request the grid has made, in order. */
function rangeRequests(api: { readonly requests: readonly string[] }): readonly string[] {
  return api.requests.filter((url) => url.includes('/api/v1/appointments?'));
}

test.describe('Agenda filters', () => {
  test.beforeEach(async ({ page }) => {
    await installApi(page, allAgendaFixtures());
  });

  test('offers every clinician, and says which one has left', async ({ page }) => {
    await page.goto('/agenda');

    await expect(dentists(page).getByRole('button', { name: 'Dra. Rivera' })).toBeVisible();
    // The suffix is the reason the full list is asked for. Without it a receptionist
    // filtering to a clinician who has left would see nothing on screen and no reason.
    await expect(
      dentists(page).getByRole('button', { name: 'Dr. Núñez (inactive)' }),
    ).toBeVisible();
  });

  test('narrows the request, so the grid redraws from what the API answers', async ({ page }) => {
    const api = await installApi(page, allAgendaFixtures());

    await page.goto('/agenda');
    await expect.poll(() => rangeRequests(api).length).toBeGreaterThan(0);

    // Nothing named yet: no clinician parameter at all. `?dentistIds=` would be a
    // filter matching nothing rather than "every clinician".
    expect(rangeRequests(api)[0]).not.toContain('dentistIds');

    await dentists(page).getByRole('button', { name: 'Dra. Rivera' }).click();

    // The claim of this file, on the wire. A browser-side filter would leave the
    // request list exactly as it was.
    await expect.poll(() => rangeRequests(api).length).toBe(2);
    expect(rangeRequests(api)[1]).toContain(`dentistIds=${DENTIST_ID}`);
  });

  test('goes back to the unfiltered day when the chip is released', async ({ page }) => {
    const api = await installApi(page, allAgendaFixtures());

    await page.goto('/agenda');
    await expect.poll(() => rangeRequests(api).length).toBe(1);

    const group = page.getByRole('group', { name: 'Dentists' });
    const rivera = group.getByRole('button', { name: 'Dra. Rivera' });
    await rivera.click();
    await expect.poll(() => rangeRequests(api).length).toBe(2);

    await rivera.click();

    // The selection is the state; the chip reports it. Checked here rather than
    // inferred from a request, because this app's `QueryClient` sets
    // `staleTime: 30_000` — so releasing the chip does *not* necessarily produce a
    // third request. See the next test, which is about exactly that.
    await expect(rivera).toHaveAttribute('aria-pressed', 'false');
    await expect(group.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // And the cleared state is what the next window asks with. Navigating forces a
    // fresh request whatever the cache decides, which is what makes this the right
    // place to prove the state rather than the timing.
    await page.getByRole('button', { name: 'Next' }).click();

    await expect.poll(() => rangeRequests(api).length).toBe(3);
    const restored = rangeRequests(api)[2];
    expect(restored).not.toContain('dentistIds');
    expect(restored).toContain('from=');
  });

  test('reuses the unfiltered answer it already has rather than asking for it twice', async ({
    page,
  }) => {
    const api = await installApi(page, allAgendaFixtures());

    await page.goto('/agenda');
    await expect.poll(() => rangeRequests(api).length).toBe(1);

    const rivera = page.getByRole('group', { name: 'Dentists' }).getByRole('button', {
      name: 'Dra. Rivera',
    });
    await rivera.click();
    await expect.poll(() => rangeRequests(api).length).toBe(2);
    await rivera.click();

    // Documented rather than merely observed. Returning to a narrowing that was
    // fetched moments ago is served from the cache, because `mount.tsx` sets
    // `staleTime: 30_000` for every query in the application — the same policy the
    // patient list runs on. The first version of this spec asserted a third request
    // here and failed, which is worth recording: an assertion that contradicts the
    // app's caching policy is an assertion about a design nobody chose.
    await page.waitForTimeout(500);
    expect(rangeRequests(api)).toHaveLength(2);

    // The grid is on the whole day either way, which is the part that matters: this is
    // a cache, not a filter, so nothing is hidden and nothing is stale enough to lie.
    await expect(page.locator('.fc-event', { hasText: 'Ana García' }).first()).toBeVisible();
  });

  test('survives a navigation, so asking for next week does not clear the selection', async ({
    page,
  }) => {
    const api = await installApi(page, allAgendaFixtures());

    await page.goto('/agenda');
    await expect.poll(() => rangeRequests(api).length).toBe(1);

    await dentists(page).getByRole('button', { name: 'Dra. Rivera' }).click();
    await expect.poll(() => rangeRequests(api).length).toBe(2);

    await page.getByRole('button', { name: 'Next' }).click();

    // The narrowed week is asked for, and the chip is still pressed. Losing the
    // selection on navigation is the failure a filter bar on the route would have,
    // and it is the one thing about this feature that a unit test on the query alone
    // would not see: nothing in the query knows the bar exists.
    await expect.poll(() => rangeRequests(api).length).toBe(3);
    expect(rangeRequests(api)[2]).toContain(`dentistIds=${DENTIST_ID}`);
    await expect(dentists(page).getByRole('button', { name: 'Dra. Rivera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('redraws from the narrowed answer rather than hiding blocks', async ({ page }) => {
    // The mock cannot filter, so the narrowed answer is served empty while the
    // unfiltered one holds appointments. If the grid were filtering in the browser,
    // the appointment would still be on screen here — which makes this the one
    // assertion in the file about pixels rather than about requests.
    await installApi(page, {
      ...allAgendaFixtures(),
      '/api/v1/appointments': { body: emptyAgenda },
    });

    await page.goto('/agenda');
    await expect(page.getByText('No appointments in this range.')).toBeVisible();

    await dentists(page).getByRole('button', { name: 'Dra. Rivera' }).click();

    // A different sentence, because "nothing booked" and "nothing for *her*" are
    // different facts. Reading the second as the first sends someone looking for a
    // cancellation that never happened.
    await expect(
      page.getByText('No appointments match these filters in this range.'),
    ).toBeVisible();
  });

  test('offers a way back only while something is narrowed', async ({ page }) => {
    await page.goto('/agenda');

    await expect(dentists(page).getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeHidden();

    await dentists(page).getByRole('button', { name: 'Dr. Núñez (inactive)' }).click();

    const clear = page.getByRole('button', { name: 'Clear filters' });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(clear).toBeHidden();
  });

  test('narrows to a clinician who has left, because their day is still worth reading', async ({
    page,
  }) => {
    const api = await installApi(page, allAgendaFixtures());

    await page.goto('/agenda');
    await expect.poll(() => rangeRequests(api).length).toBe(1);

    await dentists(page).getByRole('button', { name: 'Dr. Núñez (inactive)' }).click();

    // The filter bar is a question about history as much as about the future. A
    // client that hid the inactive rows would answer "this clinic has one clinician"
    // for a clinic that has two, and Dr. Núñez's day would be unreadable while their
    // appointments stayed on the grid.
    await expect.poll(() => rangeRequests(api).length).toBe(2);
    expect(rangeRequests(api)[1]).toContain(`dentistIds=${DEPARTED_DENTIST_ID}`);
  });
});
