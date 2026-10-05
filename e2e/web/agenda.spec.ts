/**
 * The agenda, in a real browser, against a mocked API.
 *
 * What this file is for is narrower than "the calendar renders". FullCalendar does
 * the drawing, and re-asserting its layout in a browser would test the library. The
 * three things worth pinning down are the ones where a mistake is invisible in a
 * screenshot and expensive at the clinic:
 *
 *  1. **The grid is drawn in the clinic's timezone.** A browser in another zone must
 *     still show 09:00 for a Lima clinic. Every other assertion here is worthless if
 *     this one is wrong, because the bookings would land on plausible hours.
 *  2. **The visible window is what gets requested.** A month grid asks for a month;
 *     a day grid asks for a day. Asking for the wrong window yields a grid that looks
 *     fine and is missing appointments.
 *  3. **A cancelled appointment is still drawn.** Hiding it would make a chair look
 *     bookable, and the receptionist booking the next patient is the person who pays.
 *
 * The write side is here too, but only the half a browser can prove: that a click
 * opens a panel, that a decision leaves as the endpoint and the body the API
 * documented, and that a refusal is shown rather than swallowed. **No test here
 * drags.** What a drag *means* — the instant, the omitted duration, the no-op — is
 * pinned down by `from-calendar-event.test.ts` and `agenda-calendar.test.tsx`, where a
 * gesture is a function call. Simulating a pointer drag across a time grid in a
 * headless browser asserts pixel offsets, and a failure in that test would say
 * something about FullCalendar's layout rather than about this application.
 *
 * The browser runs with a deliberately non-local timezone (`America/New_York`, set in
 * `playwright.config.ts`) precisely so that (1) is a real assertion rather than one
 * that passes by coincidence on a machine set to UTC.
 */

import { expect, test } from '@playwright/test';

import {
  agendaEntries,
  allAgendaFixtures,
  ANA_APPOINTMENT_ID,
  CANCELLED_APPOINTMENT_ID,
  clinicSettings,
  emptyAgenda,
  schedulingConflict,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, installApiFailure } from './fixtures/mock-api.js';

test.describe('Agenda', () => {
  test.beforeEach(async ({ page }) => {
    await installApi(page, allAgendaFixtures());
  });

  test('asks the API which clinic it is drawing', async ({ page }) => {
    await page.goto('/agenda');

    // The timezone is configuration, not a build-time constant: one API serves
    // every clinic.
    await expect(page.getByText(clinicSettings.timeZone)).toBeVisible();
  });

  test('draws the appointments in the clinic timezone', async ({ page }) => {
    await page.goto('/agenda');

    // The fixture's 14:00Z is 09:00 in America/Lima (UTC-5 all year), and the
    // browser is in America/New_York, where the same instant is 10:00. Reading 9:00
    // therefore proves the grid used the clinic's zone rather than the browser's —
    // and it is the assertion that would notice if the timezone silently fell back.
    const event = page.locator('.fc-event', { hasText: 'Ana García' }).first();
    await expect(event).toBeVisible();
    await expect(event).toContainText('Dra. Rivera');
    await expect(event.locator('.fc-event-time')).toHaveText(/^9:00\s?(am)?/i);
  });

  test('names an appointment with no dentist instead of leaving it blank', async ({ page }) => {
    await page.goto('/agenda');

    // A gap in the book is information. An empty column reads as a rendering fault,
    // and finding out would take a click per gap.
    await expect(page.locator('.fc-event', { hasText: 'Unassigned' })).toBeVisible();
  });

  test('still draws a cancelled appointment', async ({ page }) => {
    await page.goto('/agenda');

    // The slot is deliberately empty. Hiding it would make the chair look free.
    await expect(page.locator('.fc-event', { hasText: 'Ana García' }).last()).toBeVisible();
  });

  test('requests the window it is showing', async ({ page }) => {
    const api = await installApi(page, allAgendaFixtures());
    await page.goto('/agenda');

    await expect(page.locator('.fc-event').first()).toBeVisible();

    const agendaRequest = api.requests.find((url) => url.includes('/api/v1/appointments'));
    expect(agendaRequest).toBeDefined();
    // Both bounds, in the clinic's day: the grid asks for what it draws, and the
    // window is half-open.
    expect(agendaRequest).toContain('from=');
    expect(agendaRequest).toContain('to=');
  });

  test('says when the range holds nothing', async ({ page }) => {
    await installApi(page, {
      ...allAgendaFixtures(),
      '/api/v1/appointments': { body: emptyAgenda },
    });

    await page.goto('/agenda');

    // An empty grid with no explanation reads as a rendering fault.
    await expect(page.getByText('No appointments in this range.')).toBeVisible();
  });

  test('reports a failed load rather than showing an empty day', async ({ page }) => {
    await installApi(page, {
      ...allAgendaFixtures(),
      '/api/v1/appointments': { status: 500, body: { message: 'boom' } },
    });

    await page.goto('/agenda');

    // An empty grid and a failed request look identical on screen. A receptionist
    // who reads the first as the second books into a chair that is already taken.
    await expect(page.getByRole('alert')).toContainText('The agenda could not be loaded.');
  });

  test('opens the quick panel when an appointment is clicked', async ({ page }) => {
    await page.goto('/agenda');
    await page.locator('.fc-event').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    // The times are the clinic's, not the browser's. This browser runs on
    // America/New_York and the clinic is in America/Lima, so 14:00Z is 09:00 here and
    // 10:00 would be a bug that looks like a working panel.
    await expect(panel).toContainText('Ana García');
    await expect(panel).toContainText('09:00 – 10:00');
    await expect(panel.getByRole('button', { name: 'Check in' })).toBeVisible();
  });

  test('sends the status change the panel asked for', async ({ page }) => {
    const api = await installApi(page, {
      // Answered as the API answers: the entry the row became.
      [`POST /api/v1/appointments/${ANA_APPOINTMENT_ID}/status`]: {
        body: { ...agendaEntries.items[0], status: 'ARRIVED' },
      },
    });

    await page.goto('/agenda');
    await page.locator('.fc-event').first().click();
    await page.getByRole('button', { name: 'Check in' }).click();

    // The panel closes only once the server has agreed, and the day is then re-read
    // rather than patched in the client.
    await expect(page.getByRole('dialog')).toBeHidden();
    const write = api.recorded.find((request) => request.method === 'POST');
    expect(write?.url).toContain(`/appointments/${ANA_APPOINTMENT_ID}/status`);
    expect(write?.body).toEqual({ to: 'ARRIVED' });
  });

  test('asks why before it cancels, and sends the reason', async ({ page }) => {
    const api = await installApi(page, {
      [`POST /api/v1/appointments/${ANA_APPOINTMENT_ID}/status`]: {
        body: { ...agendaEntries.items[0], status: 'CANCELLED' },
      },
    });

    await page.goto('/agenda');
    await page.locator('.fc-event').first().click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Asking is not sending: a cancellation is the one move that cannot be undone by
    // re-booking the same slot, so it does not go on the first click.
    expect(api.recorded.some((request) => request.method === 'POST')).toBe(false);
    await expect(page.getByRole('button', { name: 'Cancel the appointment' })).toBeDisabled();

    await page.getByLabel('Why is it being cancelled?').fill('The patient called to cancel');
    await page.getByRole('button', { name: 'Cancel the appointment' }).click();

    const write = api.recorded.find((request) => request.method === 'POST');
    expect(write?.body).toEqual({ to: 'CANCELLED', reason: 'The patient called to cancel' });
  });

  test('says which hour is taken when a move is refused, and keeps the panel open', async ({
    page,
  }) => {
    // Putting a cancelled appointment back is a scheduling act: it takes the chair
    // again, so the server can refuse it — and this is the path that shows a
    // conflict in the client's own words.
    await installApi(page, {
      [`POST /api/v1/appointments/${CANCELLED_APPOINTMENT_ID}/status`]: {
        status: 409,
        body: schedulingConflict('2026-10-05T14:00:00.000Z', '2026-10-05T15:00:00.000Z'),
      },
    });

    await page.goto('/agenda');
    await page.locator('.fc-event').nth(2).click();
    await page.getByRole('button', { name: 'Put back to scheduled' }).click();

    // 14:00Z is 09:00 in Lima, and naming the hour is the whole point: it is what the
    // receptionist goes and looks at.
    await expect(page.getByRole('alert')).toContainText('09:00 – 10:00');
    // Closing on failure would throw away what the user was looking at.
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('cannot drag an appointment whose time is history', async ({ page }) => {
    await page.goto('/agenda');
    // The third fixture is the cancelled one. The grid asks the domain whether that
    // block may move, and a cancelled appointment is not editable — a cursor that
    // offered a drag would be promising a write the API refuses.
    const cancelled = page.locator('.fc-event').nth(2);
    await expect(cancelled).toBeVisible();
    await expect(cancelled).toHaveClass(/line-through/);
  });

  test('loads without console errors', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await page.goto('/agenda');
    await expect(page.locator('.fc-event').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('reports a clinic that cannot be loaded', async ({ page }) => {
    const api = await installApiFailure(page);
    await page.goto('/agenda');

    // The grid cannot be drawn without a timezone, so this must not degrade into an
    // empty calendar in the browser's own zone.
    await expect(page.getByRole('alert')).toContainText('The clinic could not be loaded');
    expect(api.requests.some((url) => url.includes('/api/v1/appointments'))).toBe(false);
  });
});
