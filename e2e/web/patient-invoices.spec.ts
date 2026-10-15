/**
 * Patient invoices ledger — the "Issue invoice + read side" slice.
 *
 * The profile opens and the Invoices card mounts: with the fixture present it
 * renders the two documents in newest-first order, shows stored totals and the
 * clinic's day-of-issue (America/Lima). With an empty list the card shows the
 * empty sentence and no document rows. A failed read leaves an error box.
 */
import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaInvoices,
  anaProfile,
  clinicFixture,
  noInvoices,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const INVOICES_PATH = `${PROFILE_PATH}/invoices`;

test.describe('Patient invoices', () => {
  test('shows the ledger with documents newest first, numbers, statuses, totals', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [INVOICES_PATH]: { body: anaInvoices },
      // The other profile sections are not required for this card, but registering
      // them would hide the pre-existing "could not be loaded" console noise in a
      // profile page load; to keep this spec focused on invoices, we deliberately
      // let odontogram/treatment-plans 501 here — they are not asserted. The
      // console-errors watcher captures errors; this spec only checks the invoices
      // UI.
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await expect(card).toBeVisible();
    await expect(card.getByText('Invoices')).toBeVisible();
    await expect(card.getByText('The ledger of bills raised for this patient.')).toBeVisible();

    // Newest first: F001-00002 appears before F001-00001 in the list.
    const rows = page.locator('[data-testid^="patient-invoice-row-"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('F001-00002');
    await expect(rows.nth(1)).toContainText('F001-00001');

    const row2 = page.getByTestId('patient-invoice-row-11111111-cccc-4a11-9ccc-000000000002');
    await expect(row2).toContainText('Paid');
    await expect(row2).toContainText('USD');
    await expect(row2).toContainText('$12.00');
    // Clinic day (America/Lima): 2026-10-06T15:00:00.000Z is 10:00 Lima same day.
    await expect(row2).toContainText('Oct 6, 2026');

    const row1 = page.getByTestId('patient-invoice-row-11111111-cccc-4a11-9ccc-000000000001');
    await expect(row1).toContainText('Issued');
    await expect(row1).toContainText('USD');
    await expect(row1).toContainText('$23.00');
    // 2026-10-05T02:00:00.000Z is 21:00 Lima on 2026-10-04.
    await expect(row1).toContainText('Oct 4, 2026');

    // No console errors from invoice loading.
    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('shows an empty state when there are no invoices', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [INVOICES_PATH]: { body: noInvoices },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await expect(card).toBeVisible();
    await expect(card.getByText('No invoices yet')).toBeVisible();
    const rows = page.locator('[data-testid^="patient-invoice-row-"]');
    await expect(rows).toHaveCount(0);

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('shows an error state when the invoices read fails', async ({ page }) => {
    watchForConsoleErrors(page);

    // Install minimal fixtures; let invoices fail
    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [INVOICES_PATH]: { status: 500, body: { message: 'boom' } },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await expect(card).toBeVisible();
    await expect(card.getByText('Invoices')).toBeVisible();
    await expect(card.getByText(/could not be loaded/i)).toBeVisible();

    const rows = page.locator('[data-testid^="patient-invoice-row-"]');
    await expect(rows).toHaveCount(0);

    // The app reports the load failure as an error box; network 500 may appear
    // as a console error depending on handling. Don't assert specific failure
    // strings — the UI state is what matters for this card.
  });
});
