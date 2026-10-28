/**
 * The payment ledger, in a real browser.
 *
 * The API's period arithmetic and repository filtering are covered by the SQLite
 * smoke and the PostgreSQL repository spec. These specs answer the browser-only
 * questions: does `/payments` mount, does the page show the server's collected total
 * instead of re-adding the page, and does a filter change actually reach the wire.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import { paymentLedger, paymentsFixtures } from './fixtures/api-responses.js';
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
});
