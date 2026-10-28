/**
 * The translated surfaces, in a browser.
 *
 * `frozen-clock.ts` pins English so the older specs keep their assertions; this
 * file overrides that choice before the first navigation. It covers the two
 * areas the first translation slice touched — the dashboard and the patient
 * pages — plus the switch back to English, because a language control that only
 * works in one direction is a one-way door.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  allDashboardFixtures,
  anaBalance,
  anaOdontogram,
  anaProfile,
  anaTreatmentPlans,
  clinicFixture,
  noInvoices,
  PATIENT_LIST_RESPONSE,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

test.beforeEach(async ({ page }) => {
  // Runs after the fixture's English initializer, so Spanish wins.
  await page.addInitScript(() => {
    window.localStorage.setItem('denti-code-locale', 'es');
  });
});

test.describe('Spanish', () => {
  test('translates the dashboard and switches back to English', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, { ...allDashboardFixtures(), ...clinicFixture() });

    await page.goto('/dashboard');

    await expect(page.getByRole('region', { name: 'Estadísticas de la clínica' })).toBeVisible();
    await expect(page.getByTestId('stat-card-value-Appointments')).toHaveText('3');
    await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pacientes', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Cambiar a inglés' }).click();

    await expect(page.getByRole('region', { name: 'Clinic statistics' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    expect(errors).toEqual([]);
  });

  test('translates the patient list', async ({ page }) => {
    await installApi(page, {
      '/api/v1/patients': { body: PATIENT_LIST_RESPONSE },
    });

    await page.goto('/patients');

    await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nuevo paciente' })).toBeVisible();
    await expect(page.getByPlaceholder('Buscar por nombre o número de ficha…')).toBeVisible();
    await expect(page.getByRole('link', { name: /Sofía Ramírez/ })).toContainText('Inactivo');
  });

  test('translates the patient profile sections', async ({ page }) => {
    await installApi(page, {
      ...clinicFixture(),
      '/api/v1/patients': { body: PATIENT_LIST_RESPONSE },
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
      [`/api/v1/patients/${ANA_ID}/odontogram`]: { body: anaOdontogram },
      [`/api/v1/patients/${ANA_ID}/treatment-plans`]: { body: anaTreatmentPlans },
      [`/api/v1/patients/${ANA_ID}/invoices`]: { body: noInvoices },
      [`/api/v1/patients/${ANA_ID}/balance`]: { body: anaBalance },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await expect(page.getByRole('heading', { name: /Ana García/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reservar cita' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Editar datos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alergias' })).toBeVisible();
    await expect(
      page.getByTestId('patient-balance').getByRole('heading', { name: 'Saldo' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Odontograma' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Planes de tratamiento' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Facturas' })).toBeVisible();
  });
});
