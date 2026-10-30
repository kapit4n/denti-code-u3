/**
 * Patient invoices ledger — the "Issue invoice + read side" slice.
 *
 * The profile opens and the Invoices card mounts: with the fixture present it
 * renders the two documents in newest-first order, shows the stored totals and
 * balances and the clinic's day-of-issue (America/Lima). With an empty list the
 * card shows the empty sentence and no document rows. A failed read leaves an
 * error box.
 *
 * The card draws the API's own order (the repository already sorts newest-first),
 * so the fixture is written newest-first rather than the spec re-sorting it — the
 * order is the server's claim, not the browser's.
 */
import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaBalance,
  anaInvoiceDetail,
  anaInvoices,
  anaOdontogram,
  anaProfile,
  clinicFixture,
  invoicePayment,
  noInvoices,
  noTreatmentPlans,
  settledBalance,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const INVOICES_PATH = `${PROFILE_PATH}/invoices`;
const BALANCE_PATH = `${PROFILE_PATH}/balance`;
const ROWS = '[data-testid="patient-invoice"]';
const OUTSTANDING_ID = '11111111-cccc-4a11-9ccc-000000000001';

/**
 * The profile mounts every section at once, so a spec about one of them must still
 * answer the others — an unregistered path is a 501 the browser logs. These four
 * are the sections beside the ledger; the card under test is the one asserted.
 */
function profileSections(invoices: unknown, balance: unknown = anaBalance) {
  return {
    [PROFILE_PATH]: { body: anaProfile },
    [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
    [`${PROFILE_PATH}/treatment-plans`]: { body: noTreatmentPlans },
    [INVOICES_PATH]: { body: invoices },
    [BALANCE_PATH]: { body: balance },
  };
}

test.describe('Patient invoices', () => {
  test('shows the ledger with documents newest first, numbers, statuses, totals', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      ...profileSections(anaInvoices),
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Invoices' })).toBeVisible();
    await expect(card.getByText('The documents issued for this patient')).toBeVisible();

    // Newest first: F001-00002 (issued 2026-10-06) before F001-00001 (2026-10-05).
    const rows = card.locator(ROWS);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('F001-00002');
    await expect(rows.nth(1)).toContainText('F001-00001');

    // The settled document: stored total drawn as money, no debt invented.
    await expect(rows.nth(0)).toContainText('PAID');
    await expect(rows.nth(0).getByTestId('invoice-total')).toContainText('120.00 USD');
    await expect(rows.nth(0).getByTestId('invoice-balance')).toContainText('Paid in full');
    // America/Lima is UTC−5: 15:00Z on the 6th is 10:00 Lima, same day.
    await expect(rows.nth(0)).toContainText('issued Oct 6, 2026');

    // The outstanding document.
    await expect(rows.nth(1)).toContainText('ISSUED');
    await expect(rows.nth(1).getByTestId('invoice-total')).toContainText('230.00 USD');
    await expect(rows.nth(1).getByTestId('invoice-balance')).toContainText(
      '230.00 USD outstanding',
    );
    // 02:00Z on the 5th is 21:00 Lima on the 4th — the clinic's clock, not UTC's.
    await expect(rows.nth(1)).toContainText('issued Oct 4, 2026');

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('records a payment against the selected outstanding invoice', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      ...profileSections(anaInvoices),
      [`POST /api/v1/invoices/${OUTSTANDING_ID}/payments`]: { status: 201, body: invoicePayment },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await card.getByTestId(`invoice-pay-${OUTSTANDING_ID}`).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Record a payment against F001-00001');
    await expect(dialog.getByTestId('invoice-payment-amount')).toHaveValue('230.00');

    await dialog.getByTestId('invoice-payment-method').click();
    await page.getByRole('option', { name: 'Cash' }).click();
    await dialog.getByTestId('invoice-payment-reference').fill('front desk');
    await dialog.getByRole('button', { name: 'Record payment' }).click();

    await expect(dialog).toBeHidden();

    const posted = api.recorded.find(
      (request) =>
        request.method === 'POST' &&
        new URL(request.url).pathname === `/api/v1/invoices/${OUTSTANDING_ID}/payments`,
    );
    expect(posted?.body).toEqual({
      method: 'CASH',
      amountMinor: 23000,
      reference: 'front desk',
    });
    expect(errors).toEqual([]);
  });

  test('opens a patient-fixed payment dialog from the balance card', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      ...profileSections(anaInvoices),
      [`/api/v1/invoices/${OUTSTANDING_ID}`]: { body: anaInvoiceDetail },
      [`POST /api/v1/invoices/${OUTSTANDING_ID}/payments`]: { status: 201, body: invoicePayment },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await page.getByTestId('patient-record-payment').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('payments-record-patient')).toContainText('Ana García');
    await expect(dialog.getByTestId('payments-record-patient-balance')).toHaveText(
      'Owes 230.00 USD',
    );
    await expect(dialog.locator('#payments-record-patient')).toHaveCount(0);

    await dialog.getByTestId('payments-record-invoice').click();
    await page.getByRole('option', { name: /F001-00001/ }).click();

    await expect(dialog.getByTestId('payments-record-treatments')).toContainText(
      'Composite filling',
    );
    await expect(dialog.getByTestId('payments-record-treatments')).toContainText(
      'Scaling and prophylaxis',
    );

    await dialog.getByTestId('payments-record-method').click();
    await page.getByRole('option', { name: 'Cash' }).click();
    await dialog.getByTestId('payments-record-submit').click();

    await expect(dialog).toBeHidden();
    const posted = api.recorded.find(
      (request) =>
        request.method === 'POST' &&
        new URL(request.url).pathname === `/api/v1/invoices/${OUTSTANDING_ID}/payments`,
    );
    expect(posted?.body).toEqual({ method: 'CASH', amountMinor: 23000 });
    expect(errors).toEqual([]);
  });

  test('shows an empty state when there are no invoices', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      ...profileSections(noInvoices, settledBalance),
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await expect(card).toBeVisible();
    await expect(card.getByText('No invoices for this patient yet.')).toBeVisible();
    await expect(card.locator(ROWS)).toHaveCount(0);

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('shows an error state when the invoices read fails', async ({ page }) => {
    watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [`${PROFILE_PATH}/treatment-plans`]: { body: noTreatmentPlans },
      [INVOICES_PATH]: { status: 500, body: { message: 'boom' } },
      [BALANCE_PATH]: { body: anaBalance },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-invoices');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Invoices' })).toBeVisible();
    await expect(card.getByRole('alert')).toContainText('The invoices could not be loaded.');

    await expect(card.locator(ROWS)).toHaveCount(0);
  });
});
