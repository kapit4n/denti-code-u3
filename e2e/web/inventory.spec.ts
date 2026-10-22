/**
 * Inventory, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why). These specs answer the
 * one question the unit suite cannot: **does the page present stock honestly and
 * send the movement the form describes?** The API's own rules are covered by
 * `apps/api/test/inventory-route.integration.test.ts` and the SQLite smoke.
 *
 * Three things here are easy to get plausibly wrong and invisible to typecheck:
 * a low-stock card that calls every row low, a cost converted twice into minor
 * units, and a shortage that clears the draft instead of quoting the refusal.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  addedInventoryItem,
  clinicFixture,
  inventoryItems,
  recordedStockMovement,
  resinStockMovements,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const ITEMS_PATH = '/api/v1/inventory/items';
const RESIN_ID = '11111111-aaaa-4bbb-8ccc-000000000001';
const ADDED_ID = '11111111-aaaa-4bbb-8ccc-000000000003';

function inventoryFixtures() {
  return {
    ...clinicFixture(),
    [ITEMS_PATH]: { body: inventoryItems },
    [`${ITEMS_PATH}/${RESIN_ID}/movements`]: { body: resinStockMovements },
    [`${ITEMS_PATH}/${ADDED_ID}/movements`]: { body: { items: [] } },
  };
}

test.describe('Inventory', () => {
  test('draws the stock and calls out only the item at or below its minimum', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, inventoryFixtures());

    await page.goto('/inventory');

    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByTestId('inventory-item')).toHaveCount(2);

    const rows = page.getByTestId('inventory-item');
    await expect(rows.nth(0)).toContainText('Composite resin A2');
    await expect(rows.nth(0)).toContainText('2 syringe');
    await expect(rows.nth(0)).toContainText('45.00 each');
    await expect(rows.nth(1)).toContainText('Gauze');
    await expect(rows.nth(1)).toContainText('40 pack');
    await expect(rows.nth(1)).toContainText('8.00 each');

    // One badge, on the row whose stock is at or below its own minimum — not on
    // the one that happens to come first, and not on both.
    await expect(page.getByTestId('low-stock-badge')).toHaveCount(1);
    await expect(rows.nth(0).getByTestId('low-stock-badge')).toBeVisible();
    await expect(rows.nth(1).getByTestId('low-stock-badge')).toHaveCount(0);

    await expect(page.getByTestId('inventory-low-stock')).toContainText(
      '1 item at or below the minimum',
    );
    await expect(page.getByTestId('low-stock-item')).toHaveCount(1);
    await expect(page.getByTestId('low-stock-item')).toContainText('2 syringe of 3');

    expect(errors).toEqual([]);
  });

  test('adds an item, sending its cost as minor units and its opening stock', async ({ page }) => {
    const api = await installApi(page, {
      ...inventoryFixtures(),
      [`POST ${ITEMS_PATH}`]: { status: 201, body: { item: addedInventoryItem } },
    });

    await page.goto('/inventory');
    await page.getByTestId('inventory-name').fill('Lidocaine 2%');
    await page.getByTestId('inventory-sku').fill('LIDO-2');
    await page.getByTestId('inventory-unit').fill('box');
    await page.getByTestId('inventory-opening-stock').fill('12');
    await page.getByTestId('inventory-min-stock').fill('4');
    await page.getByTestId('inventory-cost').fill('80.00');
    await page.getByTestId('add-inventory-item').click();

    // The typed 80.00 must cross the wire as 8000 minor units exactly once.
    await expect.poll(() => api.recorded.find((request) => request.method === 'POST')).toBeTruthy();
    expect(api.recorded.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'Lidocaine 2%',
      sku: 'LIDO-2',
      description: null,
      unit: 'box',
      openingStock: 12,
      minStock: 4,
      costMinor: 8000,
    });

    // Cleared only after the server answered with the row it stored.
    await expect(page.getByTestId('inventory-name')).toHaveValue('');
    await expect(page.getByTestId('inventory-cost')).toHaveValue('');
  });

  test('records usage with the movement the form describes', async ({ page }) => {
    const api = await installApi(page, {
      ...inventoryFixtures(),
      [`POST ${ITEMS_PATH}/${RESIN_ID}/movements`]: {
        status: 201,
        body: recordedStockMovement,
      },
    });

    await page.goto('/inventory');
    await page.getByTestId('movement-item').selectOption(RESIN_ID);
    await page.getByTestId('movement-type').selectOption('USAGE');
    await page.getByTestId('movement-quantity').fill('1');
    await page.getByTestId('movement-reference').fill('Visit 42');
    await page.getByTestId('record-movement').click();

    await expect.poll(() => api.recorded.find((request) => request.method === 'POST')).toBeTruthy();
    expect(api.recorded.find((request) => request.method === 'POST')?.body).toEqual({
      type: 'USAGE',
      quantity: 1,
      reference: 'Visit 42',
    });

    await expect(page.getByTestId('movement-quantity')).toHaveValue('');
    // The history is the selected item's, drawn from the server's ledger.
    await expect(page.getByTestId('stock-movement')).toHaveCount(2);
    await expect(page.getByTestId('stock-movement').first()).toContainText('Usage');
    await expect(page.getByTestId('stock-movement-quantity').first()).toContainText('−1 syringe');
  });

  test('quotes the refusal and keeps the draft when stock is short', async ({ page }) => {
    await installApi(page, {
      ...inventoryFixtures(),
      [`POST ${ITEMS_PATH}/${RESIN_ID}/movements`]: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'Not enough stock for Composite resin A2',
            requestId: 'e2e',
          },
        },
      },
    });

    await page.goto('/inventory');
    await page.getByTestId('movement-item').selectOption(RESIN_ID);
    await page.getByTestId('movement-type').selectOption('USAGE');
    await page.getByTestId('movement-quantity').fill('9');
    await page.getByTestId('record-movement').click();

    await expect(page.getByText('Not enough stock for Composite resin A2')).toBeVisible();
    await expect(page.getByTestId('movement-quantity')).toHaveValue('9');
    // Still the same item: a refusal must not make the page forget what was being
    // recorded and drop the history.
    await expect(page.getByTestId('stock-movement')).toHaveCount(2);
  });
});
