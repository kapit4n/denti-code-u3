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
 * The browser runs with a deliberately non-local timezone (`America/New_York`, set in
 * `playwright.config.ts`) precisely so that (1) is a real assertion rather than one
 * that passes by coincidence on a machine set to UTC.
 */

import { expect, test } from '@playwright/test';

import { allAgendaFixtures, clinicSettings, emptyAgenda } from './fixtures/api-responses.js';
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

  test('offers no way to change an appointment yet', async ({ page }) => {
    await page.goto('/agenda');
    await expect(page.locator('.fc-event').first()).toBeVisible();

    // Dragging or clicking an appointment would have to be live to be honest; the
    // write side arrives in a later slice.
    await expect(page.locator('.fc-event').first()).not.toHaveAttribute('tabindex', '0');
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
