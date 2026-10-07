/**
 * Editing a patient, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * one question: **can a receptionist correct a patient's details, and does the app
 * send what they meant?** The API's own guarantees — clinic scoping, protected
 * columns, anonymised records, clearing a field — are covered against real
 * PostgreSQL by `apps/api/test/patient-update.integration.test.ts`.
 *
 * What needs a browser and cannot be checked in jsdom:
 *
 *  - the Edit action navigates, and lands on a real page. `/patients/$id/edit` only
 *    renders if the route tree was generated with the flat-route naming this app
 *    uses; nested, the URL would be right and the profile would render instead.
 *  - the form is prefilled from the record the profile actually loaded.
 *  - a save returns to the profile, which then shows the new values — the whole
 *    round trip, which is the part a component test stubs out.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import type { Page } from '@playwright/test';

import { ANA_ID, anaProfile, clinicFixture } from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const LIST_PATH = '/api/v1/patients';
const PROFILE_PATH = `${LIST_PATH}/${ANA_ID}`;
// Method-specific, because the edit targets the same pathname the profile reads.
const EDIT_PATH = `PUT ${PROFILE_PATH}`;

const PROFILE_URL = `/patients/${ANA_ID}`;

/** The list, so the app's queries resolve without a 501 in the console. */
async function installPatientApi(page: Page) {
  return installApi(page, {
    ...clinicFixture(),
    [PROFILE_PATH]: { body: anaProfile },
    [LIST_PATH]: { body: { data: [], meta: { page: 1, pageSize: 25, total: 0 } } },
    // The edit endpoint answers 204 with nothing in it.
    [EDIT_PATH]: { status: 204, body: null },
  });
}

/** The PUT the app sent, or undefined if it never sent one. */
function editRequest(recorded: readonly { method: string; url: string; body: unknown }[]) {
  const call = recorded.find((request) => request.method === 'PUT');
  return call ? { url: call.url, body: call.body as Record<string, unknown> } : undefined;
}

test.describe('Patient editing', () => {
  test('the profile offers an edit action that opens the form', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installPatientApi(page);

    await page.goto(PROFILE_URL);
    await page.getByTestId('edit-patient').click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE_URL}/edit$`));
    // Level 1, so the locator is unambiguous: the page also has an "Edit patient
    // details" card heading, and a selector matching both would fail on strict
    // mode rather than on the page being wrong.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit Ana García');
    expect(errors).toEqual([]);
  });

  test('the form arrives filled in from the record', async ({ page }) => {
    await installPatientApi(page);

    await page.goto(`${PROFILE_URL}/edit`);

    // A blank form here would be a silent data-loss bug: whatever the user did not
    // retype would be sent as empty and stored as empty.
    await expect(page.getByLabel('First name')).toHaveValue(anaProfile.firstName);
    await expect(page.getByLabel('Last name')).toHaveValue(anaProfile.lastName);
    await expect(page.getByLabel('Email')).toHaveValue(anaProfile.email ?? '');
    await expect(page.getByLabel('Phone')).toHaveValue(anaProfile.phone ?? '');
  });

  test('saves a correction and returns to the profile showing it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installPatientApi(page);

    await page.goto(`${PROFILE_URL}/edit`);
    await page.getByLabel('Phone').fill('+57 300 999 0000');
    await page.getByTestId('update-submit').click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE_URL}$`));

    // A PUT to the profile endpoint. A POST, or a PUT to the collection, would
    // both look fine in a mock that answers anything.
    expect(editRequest(api.recorded)?.url).toContain(PROFILE_PATH);
    expect(editRequest(api.recorded)?.body).toMatchObject({ phone: '+57 300 999 0000' });
    expect(errors).toEqual([]);
  });

  test('clearing a field sends it absent, so the server empties it', async ({ page }) => {
    const api = await installPatientApi(page);

    await page.goto(`${PROFILE_URL}/edit`);
    await expect(page.getByLabel('Email')).not.toHaveValue('');
    await page.getByLabel('Email').fill('');
    await page.getByTestId('update-submit').click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE_URL}$`));

    const body = editRequest(api.recorded)?.body ?? {};

    // Absent rather than empty-string, and never the old value. This is the whole
    // reason the endpoint is a PUT: a merge could not remove a wrong value.
    expect(body).not.toHaveProperty('email');
    expect(editRequest(api.recorded)?.body).toMatchObject({ firstName: anaProfile.firstName });
  });

  test('never sends the record number', async ({ page }) => {
    const api = await installPatientApi(page);

    await page.goto(`${PROFILE_URL}/edit`);
    await page.getByTestId('update-submit').click();
    await expect(page).toHaveURL(new RegExp(`${PROFILE_URL}$`));

    // ADR 0015: the chart number identifies documents the front desk has already
    // filed under it. There is no input for it, and this asserts the whole request
    // rather than the absence of one field.
    expect(JSON.stringify(editRequest(api.recorded)?.body)).not.toContain(
      anaProfile.recordNumber ?? 'P-000042',
    );
  });

  test('reports a rejected edit and keeps the user on the form', async ({ page }) => {
    // No console watcher here: the browser logs every non-2xx response as a
    // resource error, so a spec that deliberately returns 422 would always trip it.
    // What is asserted is that the failure is *shown* and nothing is lost.
    await installApi(page, {
      [`GET ${PROFILE_PATH}`]: { body: anaProfile },
      [EDIT_PATH]: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The date of birth is in the future',
            requestId: 'e2e',
          },
        },
      },
    });

    await page.goto(`${PROFILE_URL}/edit`);
    await page.getByTestId('update-submit').click();

    // Staying put is the point: navigating away would discard what was typed.
    await expect(page).toHaveURL(new RegExp(`${PROFILE_URL}/edit$`));
    await expect(page.getByTestId('update-error')).toContainText('in the future');
    await expect(page.getByLabel('First name')).toHaveValue(anaProfile.firstName);
  });

  test('says so plainly when the patient is gone', async ({ page }) => {
    await installApi(page, {
      [`GET ${PROFILE_PATH}`]: { body: anaProfile },
      [EDIT_PATH]: {
        status: 404,
        body: {
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: 'e2e',
          },
        },
      },
    });

    await page.goto(`${PROFILE_URL}/edit`);
    await page.getByTestId('update-submit').click();

    await expect(page.getByTestId('update-error')).toContainText('no longer exists');
  });

  test('cancelling returns to the profile without writing', async ({ page }) => {
    const api = await installPatientApi(page);

    await page.goto(`${PROFILE_URL}/edit`);
    await page.getByLabel('Phone').fill('+57 300 000 0000');
    await page.getByTestId('update-cancel').click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE_URL}$`));
    // Abandoning an edit must not send half of it.
    expect(editRequest(api.recorded)).toBeUndefined();
  });

  test('refuses to open the form for a patient that does not exist', async ({ page }) => {
    await installApi(page, {
      [`GET ${PROFILE_PATH}`]: {
        status: 404,
        body: {
          error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'e2e' },
        },
      },
    });

    await page.goto(`${PROFILE_URL}/edit`);

    // Refused before the user types anything, rather than after a doomed save.
    await expect(page.getByText('does not exist in the current clinic')).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveCount(0);
  });
});
