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
  allAgendaFixtures,
  allDashboardFixtures,
  anaBalance,
  anaOdontogram,
  anaProfile,
  anaTreatmentPlans,
  clinicFixture,
  noInvoices,
  openVisit,
  PATIENT_LIST_RESPONSE,
  VISIT_ID,
  visitWorkspaceFixtures,
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

  test('translates the agenda and its quick panel', async ({ page }) => {
    await installApi(page, allAgendaFixtures());

    await page.goto('/agenda');

    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Día', exact: true })).toBeVisible();

    const dentists = page.getByRole('group', { name: 'Odontólogos' });
    await expect(dentists.getByRole('button', { name: 'Todos' })).toBeVisible();
    await expect(dentists.getByRole('button', { name: 'Dr. Núñez (de baja)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Sillones' })).toBeVisible();

    await page.locator('.fc-event').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toContainText('Confirmada');
    await expect(panel.getByText('Odontólogo', { exact: true })).toBeVisible();
    await expect(panel.getByText('Sillón', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Registrar llegada' })).toBeVisible();
  });

  test('translates the visit directory and workspace', async ({ page }) => {
    await installApi(page, {
      ...visitWorkspaceFixtures(),
      '/api/v1/visits': {
        body: {
          items: [
            {
              ...openVisit,
              patientName: 'Ana García',
              dentistName: 'Dra. Rivera',
            },
            {
              ...openVisit,
              id: '11111111-7777-4888-8999-000000000099',
              patientName: 'Beto Silva',
              dentistId: null,
              dentistName: null,
              status: 'COMPLETED',
              startedAt: null,
              endedAt: null,
            },
          ],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        },
      },
      [`/api/v1/visits/${VISIT_ID}/notes`]: { body: { notes: [] } },
    });

    await page.goto('/visits');

    await expect(page.getByRole('heading', { name: 'Visitas', exact: true })).toBeVisible();
    await expect(page.getByText('Visitas recientes')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Paciente' })).toBeVisible();
    await expect(page.getByText('Dra. Rivera')).toBeVisible();
    await expect(page.getByText('Abierta')).toBeVisible();
    await expect(page.getByText('Sin asignar')).toBeVisible();

    await page.goto(`/visits/${VISIT_ID}`);

    await expect(page.getByRole('heading', { name: 'Ana García' })).toBeVisible();
    await expect(page.getByTestId('visit-status')).toHaveText('Abierta');
    await expect(page.getByText('P-000001 · Iniciada desde una cita')).toBeVisible();
    await expect(page.getByTestId('complete-visit')).toHaveText('Completar visita');
    await expect(page.getByRole('heading', { name: 'Resumen clínico' })).toBeVisible();
    await expect(page.getByText('No hay resumen clínico registrado.')).toBeVisible();

    await page.getByRole('button', { name: 'Notas', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Notas clínicas' })).toBeVisible();
    await expect(page.getByText('Aún no hay notas.')).toBeVisible();
    await expect(page.getByTestId('add-note')).toHaveText('Añadir nota');
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
