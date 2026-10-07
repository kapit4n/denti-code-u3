/**
 * Booking an appointment from the agenda, in a real browser, against a mocked API.
 *
 * The unit tests prove the dialog sends what the form holds. This file proves the two
 * ends of that path are wired to each other, which a unit test cannot see:
 *
 *  1. **A click on an empty slot is the time choice.** The grid is the time picker, so
 *     the instant that leaves as `startsAt` is the slot the user clicked — in the
 *     *clinic's* zone. This browser runs on `America/New_York` (see
 *     `playwright.config.ts`), so a client that used the browser's own clock would send
 *     an hour that is plausible and wrong. That is the failure this file exists for.
 *  2. **The booking leaves as the documented body.** Patient, clinician, duration and
 *     the optional fields — asserted against the exact JSON the API validates.
 *  3. **A refusal is shown.** The dialog checks nothing itself, so a domain answer is
 *     the only thing that will ever tell a receptionist that the slot cannot be booked.
 *
 * What is *not* here: the rules. Overlap, opening hours and inactive clinicians are
 * the domain's, tested against the domain and against a real API elsewhere. This file
 * asserts that whatever the domain said reaches the screen.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  bookingFixtures,
  bookedAppointment,
  CHAIR_ID,
  DENTIST_ID,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const CREATE_PATH = 'POST /api/v1/appointments';

/**
 * The 30-minute lane for 10:00 in America/Lima.
 *
 * The grid runs 06:00–21:00 with FullCalendar's default 30-minute lanes, so 10:00 is
 * the ninth lane — and it is free, where the fixtures' appointments sit at 09:00, 11:00
 * and 13:00. Computed here rather than guessed in the test body so a change to the
 * grid's hours shows up as one edit with an explanation.
 */
const TEN_AM_LIMA_LANE = 8;

/** What 10:00 in Lima is as an instant, which is what the API expects. */
const TEN_AM_LIMA = '2026-10-05T15:00:00.000Z';

async function openBookingDialogAtTen(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.fc-timegrid-slot-lane').nth(TEN_AM_LIMA_LANE).click();
  await expect(page.getByTestId('appointment-booking-dialog')).toBeVisible();
}

/**
 * The dialog, as a locator.
 *
 * **Every interaction in this file is scoped to it.** The header carries its own
 * patient search box, and `getByLabel('Patient')` matches both — so an unscoped
 * locator would quietly fill the header's field, the dialog would stay empty, and the
 * spec would fail on the submission rather than on the thing it meant to test.
 */
function dialog(page: import('@playwright/test').Page) {
  return page.getByTestId('appointment-booking-dialog');
}

/** Picks the patient by name, through the real search box. */
async function choosePatient(page: import('@playwright/test').Page): Promise<void> {
  await dialog(page).getByLabel('Patient').fill('García');
  await page.getByRole('option', { name: /Ana García/ }).click();
}

/** Picks an option from one of the dialog's dropdowns. */
async function choose(page: import('@playwright/test').Page, trigger: string, option: RegExp) {
  await dialog(page).getByTestId(trigger).click();
  await page.getByRole('option', { name: option }).click();
}

/** Fills the optional notes field. */
async function fillNotes(page: import('@playwright/test').Page, notes: string): Promise<void> {
  await dialog(page).getByLabel('Notes').fill(notes);
}

test.describe('Booking an appointment', () => {
  test.beforeEach(async ({ page }) => {
    await installApi(page, bookingFixtures());
  });

  test('opens the dialog for the slot that was clicked, in clinic time', async ({ page }) => {
    await installApi(page, {
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);

    // The dialog names the hour it is about to book, in the clinic's words. 15:00Z is
    // 10:00 in Lima and 11:00 in this browser's New York — so a client that rendered
    // the browser's own hour would say 11:00 here, and that is the bug.
    await expect(page.getByTestId('appointment-booking-dialog')).toContainText('10:00');
    // And the span, recomputed as the duration changes, rather than only the hour.
    await expect(page.getByTestId('appointment-booking-dialog')).toContainText('10:00 – 10:30');
  });

  test('sends the clicked instant with the chosen people', async ({ page }) => {
    const api = await installApi(page, {
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);
    await choosePatient(page);
    await choose(page, 'booking-dentist', /Dra\. Rivera/);
    await dialog(page).getByTestId('booking-submit').click();

    // The dialog waits for the API rather than closing on the click: a booking that
    // looked done and then failed is the expensive version of this screen.
    await expect(page.getByTestId('appointment-booking-dialog')).toBeHidden();

    const write = api.recorded.find((request) => request.url.endsWith('/api/v1/appointments'));
    expect(write?.body).toEqual({
      patientId: ANA_ID,
      dentistId: DENTIST_ID,
      startsAt: TEN_AM_LIMA,
      durationMinutes: 30,
    });
  });

  test('includes the chair and the notes when they are given', async ({ page }) => {
    const api = await installApi(page, {
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);
    await choosePatient(page);
    await choose(page, 'booking-dentist', /Dr\. Quispe/);
    await choose(page, 'booking-duration', /45 min/);
    await choose(page, 'booking-chair', /Sillón 1/);
    await fillNotes(page, 'Traer la radiografía anterior');
    await dialog(page).getByTestId('booking-submit').click();

    await expect(page.getByTestId('appointment-booking-dialog')).toBeHidden();

    // The exact body the API validates: an id the clinic owns, the duration the user
    // picked, and the optional fields present because they were filled — not because
    // the form defaults happened to be truthy.
    const write = api.recorded.find((request) => request.url.endsWith('/api/v1/appointments'));
    expect(write?.body).toEqual({
      patientId: ANA_ID,
      dentistId: '11111111-2222-4333-8444-000000000002',
      startsAt: TEN_AM_LIMA,
      durationMinutes: 45,
      chairId: CHAIR_ID,
      notes: 'Traer la radiografía anterior',
    });
  });

  test('re-reads the day after booking rather than drawing the form’s own values', async ({
    page,
  }) => {
    const api = await installApi(page, {
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    const agendaReads = () =>
      api.requests.filter((url) => url.includes('/api/v1/appointments?')).length;

    await page.goto('/agenda');
    await expect(page.locator('.fc-event').first()).toBeVisible();
    const readsBefore = agendaReads();

    await openBookingDialogAtTen(page);
    await choosePatient(page);
    await choose(page, 'booking-dentist', /Dra\. Rivera/);
    await dialog(page).getByTestId('booking-submit').click();
    await expect(page.getByTestId('appointment-booking-dialog')).toBeHidden();

    // Nothing is written into the cache (ADR 0007): the block the receptionist is
    // looking for is the server's answer, so the day is fetched again.
    await expect.poll(agendaReads).toBeGreaterThan(readsBefore);
  });

  test('names the missing fields instead of refusing silently', async ({ page }) => {
    await page.goto('/agenda');
    await openBookingDialogAtTen(page);
    await dialog(page).getByTestId('booking-submit').click();

    // Both required choices, each announced: a submit button that does nothing is the
    // one failure mode a receptionist cannot work around.
    await expect(page.getByText('Choose a patient')).toBeVisible();
    await expect(page.getByText('Choose a clinician').last()).toBeVisible();
  });

  test('shows the refusal when the domain refuses the slot', async ({ page }) => {
    await installApi(page, {
      ...bookingFixtures(),
      [CREATE_PATH]: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'The clinic opens at 08:00 on 2026-10-05',
            requestId: 'e2e',
          },
        },
      },
    });

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);
    await choosePatient(page);
    await choose(page, 'booking-dentist', /Dra\. Rivera/);
    await dialog(page).getByTestId('booking-submit').click();

    // The server's sentence, and the dialog still open: the person has to correct the
    // slot or the details, and a dialog that vanished would take their typing with it.
    await expect(page.getByTestId('booking-error')).toContainText('The clinic opens at 08:00');
    await expect(page.getByTestId('appointment-booking-dialog')).toBeVisible();
  });

  test('asks only for the active resources, while the filter bar asks for all of them', async ({
    page,
  }) => {
    const api = await installApi(page, bookingFixtures());

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);

    // A convenience, not the rule: the API enforces it (ADR 0020) and a clinician
    // deactivated while the dialog was open is refused by name. What is asserted here
    // is only that the two callers disagree in the right direction.
    //
    // **Both requests, not the first one.** The agenda mounts a filter bar, so
    // `?onlyActive=false` went out on page load, before the dialog ever opened — and
    // `requests.find(url => url.includes('/dentists'))` returns the *earliest* match,
    // which is the bar's. That assertion passed for the wrong reason until it was
    // written this way: it would have reported the dialog asking for the whole clinic
    // as a pass.
    await expect.poll(() => api.requests.filter((url) => url.includes('/dentists')).length).toBe(2);

    const [filterRequest, dialogRequest] = api.requests.filter((url) => url.includes('/dentists'));
    expect(filterRequest).toContain('onlyActive=false');
    expect(dialogRequest).toContain('onlyActive=true');

    const [filterChairs, dialogChairs] = api.requests.filter((url) => url.includes('/chairs'));
    expect(filterChairs).toContain('onlyActive=false');
    expect(dialogChairs).toContain('onlyActive=true');
  });

  test('closes without booking anything when the dialog is dismissed', async ({ page }) => {
    const api = await installApi(page, bookingFixtures());

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByTestId('appointment-booking-dialog')).toBeHidden();
    // Escape, the overlay and Cancel all mean the same thing: stop looking at this
    // slot. Nothing was written, so nothing may have been sent.
    expect(api.recorded.some((request) => request.method === 'POST')).toBe(false);
  });

  test('loads and books without console errors', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...bookingFixtures(),
      [CREATE_PATH]: { status: 201, body: bookedAppointment() },
    });

    await page.goto('/agenda');
    await openBookingDialogAtTen(page);
    await choosePatient(page);
    await choose(page, 'booking-dentist', /Dra\. Rivera/);
    await dialog(page).getByTestId('booking-submit').click();
    await expect(page.getByTestId('appointment-booking-dialog')).toBeHidden();

    expect(errors).toEqual([]);
  });
});
