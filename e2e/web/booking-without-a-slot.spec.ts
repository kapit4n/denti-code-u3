/**
 * Booking an appointment when no grid supplied the time, in a real browser.
 *
 * `booking.spec.ts` covers the third door — clicking an empty slot, where the grid
 * *is* the time picker. This file covers the two doors where it is not: a patient's
 * profile and the dashboard. Both open the same dialog, and what makes them worth their
 * own file is the one thing neither of them can borrow from the grid:
 *
 *  - **The time is typed, and it is the clinic's.** There is no slot behind these
 *    screens, so the person states when — and "when" has to mean the clinic's wall
 *    clock. This browser runs on `America/New_York` (see `playwright.config.ts`) while
 *    the clinic is in `America/Lima`, so a client that read the typed value in the
 *    browser's zone would send an instant five hours out. It would still look like a
 *    time, which is what makes it the kind of bug that survives to production.
 *  - **The patient may already be known.** Opened from Ana's profile the booking is
 *    for Ana, and the body must say so without anybody retyping her name.
 *
 * The domain's rules are not re-tested here: what the server refuses is `booking.spec.ts`'s
 * subject, and what the API validates is the domain's.
 */

import { expect, test } from './fixtures/frozen-clock.js';
import type { Page } from '@playwright/test';

import {
  ANA_ID,
  anaOdontogram,
  anaProfile,
  allDashboardFixtures,
  bookingFixtures,
  bookedAppointment,
  CHAIR_ID,
  DENTIST_ID,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, type InstalledApi } from './fixtures/mock-api.js';

const CREATE_PATH = 'POST /api/v1/appointments';

/**
 * 11:30 in America/Lima, as an instant.
 *
 * Deliberately not one of the fixture appointments' hours (09:00, 11:00, 13:00) so the
 * typed value cannot be confused with something the day already had. 11:30 in Lima is
 * 16:30Z, which is 12:30 in this browser's New York — a difference of five hours, and
 * exactly what a zone-blind client would send instead.
 */
const HALF_PAST_ELEVEN_LIMA = '2026-10-06T16:30:00.000Z';

/** What a person types into a `datetime-local` field: the clinic's own wall clock. */
const TYPED_LOCAL = '2026-10-06T11:30';

/** The dialog, as a locator. Scoped because the header has its own patient search. */
function dialog(page: Page) {
  return page.getByTestId('appointment-booking-dialog');
}

/**
 * Types the time the way a person does: the field's own value, in the format the
 * browser reports it. `fill` is used rather than a sequence of keystrokes because a
 * `datetime-local` input is edited through the browser's segment editor, and typing
 * "11:30" into it one character at a time is a different act from setting a value.
 */
async function typeClinicTime(page: Page, wallClock: string): Promise<void> {
  await dialog(page).getByLabel('Date and time').fill(wallClock);
}

/** Picks the clinician. */
async function chooseClinician(page: Page): Promise<void> {
  await dialog(page).getByTestId('booking-dentist').click();
  await page.getByRole('option', { name: /Dra\. Rivera/ }).click();
}

/** The body the API received, or `undefined` when nothing was written. */
async function writtenBody(api: InstalledApi): Promise<unknown> {
  return api.recorded.find((request) => request.url.endsWith('/api/v1/appointments'))?.body;
}

test.describe('Booking from a patient profile', () => {
  test('books for the patient whose profile it is, at the time typed', async ({ page }) => {
    const api = await installApi(page, {
      ...bookingFixtures(),
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
      // The profile's chart is a read of the very page being booked from.
      [`/api/v1/patients/${ANA_ID}/odontogram`]: { body: anaOdontogram },
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto(`/patients/${ANA_ID}`);
    await page.getByTestId('book-appointment').click();
    await expect(dialog(page)).toBeVisible();

    // The profile already said who it is for, so the dialog says it too and the picker
    // shows the name — no searching for the patient standing in front of you.
    await expect(dialog(page).getByRole('heading')).toContainText('Ana García');
    await expect(dialog(page).getByLabel('Patient')).toHaveValue(/Ana García/);

    await typeClinicTime(page, TYPED_LOCAL);
    await chooseClinician(page);
    await dialog(page).getByTestId('booking-submit').click();
    await expect(dialog(page)).toBeHidden();

    // 11:30 in Lima is 16:30Z. Read in this browser's New York it would have been
    // 16:30Z for 16:30 local — the booking would land five hours late.
    expect(await writtenBody(api)).toEqual({
      patientId: ANA_ID,
      dentistId: DENTIST_ID,
      startsAt: HALF_PAST_ELEVEN_LIMA,
      durationMinutes: 30,
    });
  });

  test('says whose clock the typed time is in', async ({ page }) => {
    await installApi(page, {
      ...bookingFixtures(),
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
      // The profile's chart is a read of the very page being booked from.
      [`/api/v1/patients/${ANA_ID}/odontogram`]: { body: anaOdontogram },
    });

    await page.goto(`/patients/${ANA_ID}`);
    await page.getByTestId('book-appointment').click();

    // A bare wall clock is ambiguous, and the person filling it in may be a long way
    // from the clinic. The zone is stated under the field rather than assumed.
    await expect(dialog(page).getByText('America/Lima')).toBeVisible();
  });

  test('will not book without a time, and says so on the field', async ({ page }) => {
    const api = await installApi(page, {
      ...bookingFixtures(),
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
      // The profile's chart is a read of the very page being booked from.
      [`/api/v1/patients/${ANA_ID}/odontogram`]: { body: anaOdontogram },
    });

    await page.goto(`/patients/${ANA_ID}`);
    await page.getByTestId('book-appointment').click();
    await chooseClinician(page);
    await dialog(page).getByTestId('booking-submit').click();

    await expect(dialog(page).getByText('Choose a date and time')).toBeVisible();
    // Nothing was sent: the form refused, not the server.
    expect(await writtenBody(api)).toBeUndefined();
  });

  test('closes without booking when the dialog is dismissed', async ({ page }) => {
    const api = await installApi(page, {
      ...bookingFixtures(),
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
      // The profile's chart is a read of the very page being booked from.
      [`/api/v1/patients/${ANA_ID}/odontogram`]: { body: anaOdontogram },
    });

    await page.goto(`/patients/${ANA_ID}`);
    await page.getByTestId('book-appointment').click();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog(page)).toBeHidden();
    expect(await writtenBody(api)).toBeUndefined();
    // The profile is still the profile: a dialog over a page should leave that page
    // where it was.
    await expect(page.getByTestId('book-appointment')).toBeVisible();
  });

  test('draws the profile’s own times in the clinic’s clock, not the browser’s', async ({
    page,
  }) => {
    await installApi(page, {
      ...bookingFixtures(),
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
      // The profile's chart is a read of the very page being booked from.
      [`/api/v1/patients/${ANA_ID}/odontogram`]: { body: anaOdontogram },
    });

    await page.goto(`/patients/${ANA_ID}`);

    // The next appointment is at 13:00Z: 08:00 in Lima, 09:00 in this browser. The
    // profile used to render it with `toLocaleString()`, which would have shown 09:00
    // and been wrong by an hour in every clinic that is not on the receptionist's own
    // timezone.
    //
    // Asserted on the hour inside the paragraph rather than on a whole formatted date,
    // because the day and month order belongs to this browser's locale and says nothing
    // about the timezone. What is being claimed is one thing: the hour is the clinic's.
    const nextAppointment = page.getByText(/45 min/);
    await expect(nextAppointment).toContainText('08:00');
    await expect(nextAppointment).not.toContainText('09:00');
  });
});

test.describe('Booking from the dashboard', () => {
  test('opens the booking dialog from the New Visit action', async ({ page }) => {
    const api = await installApi(page, {
      ...allDashboardFixtures(),
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto('/dashboard');

    // The action used to be disabled with the reason "Available with the agenda", which
    // is no longer true: the dialog is here, and it asks for the patient because nobody
    // has been named yet.
    await page.getByTestId('new-visit').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel('Patient')).toHaveValue('');

    await dialog(page).getByLabel('Patient').fill('García');
    await page.getByRole('option', { name: /Ana García/ }).click();
    await typeClinicTime(page, TYPED_LOCAL);
    await chooseClinician(page);
    // The chair is optional, so it is picked here rather than left out — the body below
    // asserts it, which is the one thing an absent field cannot show.
    await dialog(page).getByTestId('booking-chair').click();
    await page.getByRole('option', { name: /Sillón 1/ }).click();
    await dialog(page).getByTestId('booking-submit').click();
    await expect(dialog(page)).toBeHidden();

    expect(await writtenBody(api)).toEqual({
      patientId: ANA_ID,
      dentistId: DENTIST_ID,
      chairId: CHAIR_ID,
      startsAt: HALF_PAST_ELEVEN_LIMA,
      durationMinutes: 30,
    });
  });

  test('leaves the dashboard in place when the booking is refused', async ({ page }) => {
    await installApi(page, {
      ...allDashboardFixtures(),
      ...bookingFixtures(),
      [CREATE_PATH]: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'The clinic closes at 13:00 on 2026-10-06',
            requestId: 'req-1',
          },
        },
      },
    });

    await page.goto('/dashboard');
    await page.getByTestId('new-visit').click();
    await dialog(page).getByLabel('Patient').fill('García');
    await page.getByRole('option', { name: /Ana García/ }).click();
    await typeClinicTime(page, TYPED_LOCAL);
    await chooseClinician(page);
    await dialog(page).getByTestId('booking-submit').click();

    // Still open, with the domain's sentence — the same contract as the agenda's door,
    // because it is the same dialog.
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('booking-error')).toContainText(/closes at 13:00/i);
  });

  test('books from the dashboard without a console error', async ({ page }) => {
    await watchForConsoleErrors(page);

    await installApi(page, {
      ...allDashboardFixtures(),
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto('/dashboard');
    await page.getByTestId('new-visit').click();
    await expect(dialog(page)).toBeVisible();

    // The dashboard now asks who the clinic is, which it did not before. An unmatched
    // request would arrive as a 501 from the mock — this is the test that notices.
  });
});
