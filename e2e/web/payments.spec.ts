/**
 * The payment ledger, in a real browser.
 *
 * The API's period arithmetic and repository filtering are covered by the SQLite
 * smoke and the PostgreSQL repository spec. These specs answer the browser-only
 * questions: does `/payments` mount, does the page show the server's collected total
 * instead of re-adding the page, and does a filter change actually reach the wire.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  anaInvoices,
  paymentLedger,
  paymentRecordingFixtures,
  paymentsFixtures,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

test.describe('Payments', () => {
  test('draws the period total and every ledger row', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, paymentsFixtures());

    await page.goto('/payments');

    await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
    await expect(page.getByTestId('payments-collected')).toHaveText('180.00 PEN');
    await expect(page.getByTestId('payments-count')).toHaveText('2');

    // The frozen clock is 5 October, so the default is the clinic month to date.
    await expect(page.getByTestId('payments-from')).toHaveValue('2026-10-01');
    await expect(page.getByTestId('payments-to')).toHaveValue('2026-10-05');

    const rows = page.getByTestId('payment-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Ana García');
    await expect(rows.nth(0)).toContainText('Card');
    await expect(rows.nth(0)).toContainText('4242');
    await expect(rows.nth(0)).toContainText('120.00 PEN');
    await expect(rows.nth(1)).toContainText('Luis Fernández');
    await expect(rows.nth(1)).toContainText('Cash');
    await expect(rows.nth(1)).toContainText('60.00 PEN');

    expect(errors).toEqual([]);
  });

  test('sends the chosen dates and method to the API', async ({ page }) => {
    const api = await installApi(page, paymentsFixtures());

    await page.goto('/payments');
    await expect(page.getByTestId('payments-collected')).toHaveText('180.00 PEN');

    await page.getByTestId('payments-from').fill('2026-09-01');
    await page.getByTestId('payments-to').fill('2026-09-30');
    await page.getByTestId('payments-method').selectOption('CARD');

    await expect
      .poll(() => api.requests.filter((url) => url.includes('/api/v1/payments')).at(-1) ?? '')
      .toContain('method=CARD');

    const latest = api.requests.filter((url) => url.includes('/api/v1/payments')).at(-1)!;
    expect(latest).toContain('from=2026-09-01');
    expect(latest).toContain('to=2026-09-30');
  });

  test('shows the empty sentence when the period has no payments', async ({ page }) => {
    await installApi(page, {
      ...paymentsFixtures(),
      '/api/v1/payments': {
        body: {
          ...paymentLedger,
          items: [],
          totalAmountMinor: 0,
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      },
    });

    await page.goto('/payments');

    await expect(page.getByTestId('payments-empty')).toHaveText(
      'No payments match this period and method.',
    );
    await expect(page.getByTestId('payments-collected')).toHaveText('0.00 PEN');
  });

  test('records a payment against a chosen open invoice', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, paymentRecordingFixtures());
    const openInvoice = anaInvoices.items[1];

    await page.goto('/payments');
    await page.getByTestId('payments-record').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Record a payment');

    await dialog.locator('#payments-record-patient').fill('Ana');
    await page.getByRole('option', { name: /Ana García/ }).click();

    await expect(dialog.getByTestId('payments-record-patient')).toContainText('Ana García');
    await expect(dialog.getByTestId('payments-record-patient-balance')).toContainText(
      'Owes 230.00 USD',
    );

    await expect(dialog.getByTestId('payments-record-invoice')).toBeEnabled();
    await dialog.getByTestId('payments-record-invoice').click();
    await expect(page.getByRole('option', { name: /F001-00002/ })).toHaveCount(0);
    await page.getByRole('option', { name: /F001-00001/ }).click();

    await expect(dialog.getByTestId('payments-record-amount')).toHaveValue('230.00');
    await expect(dialog.getByTestId('payments-record-outstanding')).toHaveText(
      '230.00 USD outstanding',
    );
    await expect(dialog.getByTestId('payments-record-treatments')).toContainText(
      'Composite filling',
    );
    await expect(dialog.getByTestId('payments-record-treatments')).toContainText(
      'Scaling and prophylaxis',
    );

    await dialog.getByTestId('payments-record-method').click();
    await page.getByRole('option', { name: 'Cash' }).click();
    await dialog.getByTestId('payments-record-reference').fill('front desk');
    await dialog.getByTestId('payments-record-submit').click();

    await expect(dialog).toHaveCount(0);
    expect(api.recorded).toContainEqual({
      method: 'POST',
      url: expect.stringContaining(`/api/v1/invoices/${openInvoice.id}/payments`),
      body: { method: 'CASH', amountMinor: 23_000, reference: 'front desk' },
    });
    expect(errors).toEqual([]);
  });
});
