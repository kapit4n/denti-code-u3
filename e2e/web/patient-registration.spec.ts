/**
 * Registering a patient, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * one question only: **does the app let a receptionist register a patient, and
 * does it show them what happened?** The API's own behaviour — atomic record
 * numbers, clinic scoping, rejected birth dates — is covered against real
 * PostgreSQL by `apps/api/test/patient-registration.integration.test.ts`.
 *
 * What needs a browser and cannot be checked in jsdom:
 *
 *  - the buttons actually navigate. Both were disabled for a milestone; a
 *    `<Button>` with no `asChild` renders a `<button>` and goes nowhere, which
 *    looks correct in a component test.
 *  - the flat-route wiring. `/patients/new` only renders if the route tree was
 *    generated correctly, and `patients.tsx` has no `<Outlet />`, so a nested
 *    route would render the list under the form's URL.
 *  - the form survives a real page load, including that an untouched optional
 *    input really does submit `''` and is really accepted.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import type { Page } from '@playwright/test';

import { ANA_ID, PATIENT_LIST_RESPONSE } from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, installApiFailure } from './fixtures/mock-api.js';

const LIST_PATH = '/api/v1/patients';
// The same path as the list, so the fixture has to name the method. Keyed on the
// path alone, the POST was answered with the list fixture.
const REGISTER_PATH = 'POST /api/v1/patients';

const REGISTERED = {
  id: '11111111-3333-4444-8555-000000000009',
  clinicId: '11111111-1111-4111-8111-111111111111',
  recordNumber: 'P-000009',
  firstName: 'Mateo',
  lastName: 'Salazar',
  preferredName: null,
  identificationNumber: null,
  phone: null,
  email: null,
  birthDate: null,
  isActive: true,
};

/** A profile for the patient the app prefetches after registering. */
const REGISTERED_PROFILE = {
  ...REGISTERED,
  createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z',
  identificationNumber: null,
  address: null,
  allergies: null,
  additionalData: {},
  upcomingAppointment: null,
  recentVisits: [],
  outstandingTreatments: [],
  financialBalance: { outstandingMinor: 0, chargeCount: 0, currencyCode: 'USD' },
};

/**
 * The list, served to every patient GET.
 *
 * The prefetch after registration asks for the new profile; without a fixture it
 * would 501, which the app handles, but a real fixture keeps the console clean so
 * that a genuine error in this spec is not lost in noise.
 */
async function installPatientApi(page: Page) {
  return installApi(page, {
    [LIST_PATH]: { body: PATIENT_LIST_RESPONSE },
    [`${LIST_PATH}/${REGISTERED.id}`]: { body: REGISTERED_PROFILE },
    [`${LIST_PATH}/${ANA_ID}`]: { body: { ...REGISTERED_PROFILE, id: ANA_ID } },
    [REGISTER_PATH]: { status: 201, body: REGISTERED },
  });
}

/** Fills the two required fields and submits. */
async function registerWithRequiredFieldsOnly(page: Page) {
  await page.getByLabel('First name').fill('Mateo');
  await page.getByLabel('Last name').fill('Salazar');
  await page.getByTestId('register-submit').click();
}

test.describe('Patient registration', () => {
  test('the patient list button opens the form', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installPatientApi(page);

    await page.goto('/patients');
    // A link, not a button: once the action navigates, `Button asChild` renders
    // an anchor and its role changes with it.
    await page.getByRole('link', { name: 'New Patient' }).click();

    // A flat sibling route: had this been nested under `patients.tsx`, the URL
    // would be right and the page would still show the list.
    await expect(page).toHaveURL(/\/patients\/new$/);
    await expect(page.getByRole('heading', { name: 'New patient' })).toBeVisible();
    await expect(page.getByLabel('First name')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the dashboard action opens the same form', async ({ page }) => {
    await installPatientApi(page);

    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'New Patient' }).click();

    await expect(page).toHaveURL(/\/patients\/new$/);
    await expect(page.getByRole('heading', { name: 'New patient' })).toBeVisible();
  });

  test('registers a patient from the required fields alone', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installPatientApi(page);

    await page.goto('/patients/new');
    await registerWithRequiredFieldsOnly(page);

    // The number is what the front desk reads out, so it has to be on screen.
    await expect(page.getByTestId('assigned-record-number')).toHaveText('P-000009');
    expect(errors).toEqual([]);
  });

  test('does not send blank optional fields', async ({ page }) => {
    const api = await installPatientApi(page);

    await page.goto('/patients/new');
    await registerWithRequiredFieldsOnly(page);
    await expect(page.getByTestId('assigned-record-number')).toHaveText('P-000009');

    // An untouched input is `''`, and the API rejects `''` for an optional field.
    // A patient who gave only a name has to be registrable, so the payload must
    // be exactly the two names — not six fields, four of them empty strings.
    const posted = api.recorded.find(
      (request) => request.method === 'POST' && request.url.endsWith('/api/v1/patients'),
    );
    expect(posted?.body).toEqual({ firstName: 'Mateo', lastName: 'Salazar' });
  });

  test('never sends a record number, because the server assigns it', async ({ page }) => {
    const api = await installPatientApi(page);

    await page.goto('/patients/new');
    await page.getByLabel('First name').fill('Mateo');
    await page.getByLabel('Last name').fill('Salazar');
    await page.getByLabel('Identification number').fill('CC-9-9-9');
    await page.getByTestId('register-submit').click();

    await expect(page.getByTestId('assigned-record-number')).toHaveText('P-000009');

    // The number is per clinic and sequential. A client able to post one could
    // choose a patient's chart number.
    const posted = api.recorded.find(
      (request) => request.method === 'POST' && request.url.endsWith('/api/v1/patients'),
    );
    expect(posted?.body).not.toHaveProperty('recordNumber');
  });

  test('registers a patient with every optional field filled in', async ({ page }) => {
    await installPatientApi(page);

    await page.goto('/patients/new');
    await page.getByLabel('First name').fill('Mateo');
    await page.getByLabel('Last name').fill('Salazar');
    await page.getByLabel('Preferred name').fill('Teo');
    await page.getByLabel('Identification number').fill('CC-9-9-9');
    await page.getByLabel('Phone').fill('+57 300 111 2222');
    await page.getByLabel('Email').fill('mateo@example.test');
    await page.getByLabel('Date of birth').fill('1988-03-02');
    await page.getByTestId('register-submit').click();

    await expect(page.getByTestId('assigned-record-number')).toHaveText('P-000009');
  });

  test('offers the new chart after registering', async ({ page }) => {
    await installPatientApi(page);

    await page.goto('/patients/new');
    await registerWithRequiredFieldsOnly(page);

    await page.getByRole('link', { name: 'Open chart' }).click();

    await expect(page).toHaveURL(new RegExp(`/patients/${REGISTERED.id}$`));
    await expect(page.getByRole('heading', { name: /Mateo/ })).toBeVisible();
  });

  test('shows a message next to a field left empty, and does not submit', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installPatientApi(page);

    await page.goto('/patients/new');
    await page.getByLabel('First name').fill('   ');
    await page.getByLabel('Last name').fill('Salazar');
    await page.getByTestId('register-submit').click();

    // Zod's default message here is "Too small: expected string to have >=1
    // characters". This asserts the readable one.
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('register-success')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('rejects an unusable email without a round trip', async ({ page }) => {
    await installPatientApi(page);

    await page.goto('/patients/new');
    await page.getByLabel('First name').fill('Mateo');
    await page.getByLabel('Last name').fill('Salazar');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByTestId('register-submit').click();

    await expect(page.getByTestId('assigned-record-number')).toHaveCount(0);
  });

  test('reports a rejection from the server', async ({ page }) => {
    await installPatientApi(page);
    // The birth date rule is a domain rule, so only the server can reject it.
    await installApi(page, {
      [LIST_PATH]: { body: PATIENT_LIST_RESPONSE },
      [REGISTER_PATH]: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The birth date has not happened yet',
            requestId: 'e2e',
          },
        },
      },
    });

    await page.goto('/patients/new');
    await page.getByLabel('First name').fill('Mateo');
    await page.getByLabel('Last name').fill('Salazar');
    await page.getByLabel('Date of birth').fill('2999-01-01');
    await page.getByTestId('register-submit').click();

    await expect(page.getByTestId('register-error')).toContainText(
      'The birth date has not happened yet',
    );
    // The typed values survive, so one bad field does not mean retyping the form.
    await expect(page.getByLabel('First name')).toHaveValue('Mateo');
  });

  test('explains an unreachable server', async ({ page }) => {
    await installApiFailure(page, 500);

    await page.goto('/patients/new');
    await registerWithRequiredFieldsOnly(page);

    await expect(page.getByTestId('register-error')).toBeVisible();
    await expect(page.getByTestId('assigned-record-number')).toHaveCount(0);
  });

  test('disables the submit button while saving, so the patient is not twice', async ({ page }) => {
    await installPatientApi(page);

    let releaseRequest: (() => void) | undefined;
    const holdOpen = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    await page.route('**/api/v1/patients', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await holdOpen;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(REGISTERED),
      });
    });

    await page.goto('/patients/new');
    await page.getByLabel('First name').fill('Mateo');
    await page.getByLabel('Last name').fill('Salazar');
    await page.getByTestId('register-submit').click();

    // A double submission would register the same patient twice, and the second
    // one would fail with a duplicate name the receptionist cannot explain.
    await expect(page.getByTestId('register-submit')).toBeDisabled();

    releaseRequest?.();
    await expect(page.getByTestId('assigned-record-number')).toHaveText('P-000009');
  });

  test('goes back to the list without losing the session', async ({ page }) => {
    await installPatientApi(page);

    await page.goto('/patients/new');
    await page.getByRole('link', { name: 'Back to patients' }).click();

    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
  });
});
