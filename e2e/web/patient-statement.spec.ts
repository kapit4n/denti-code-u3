/**
 * Patient statement — the "Patient balances, statements" slice's history read.
 *
 * The profile opens and the Statement card mounts, but the statement itself is not
 * fetched until the card is opened. That is the first thing the spec pins down: a
 * report the desk asked for must not cost a request (or paint a failure) before it
 * is asked for. Opened, the card draws the API's order and the server's own running
 * balances, with the clinic's days — and the closing figure agrees with the Balance
 * card beside it.
 *
 * The numbers are the fixture's, written down rather than recomputed: a spec that
 * added the rows up itself would pass a card that also added them up, and the two
 * could be wrong together. Arithmetic is the domain's, tested there.
 */
import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaBalance,
  anaInvoices,
  anaOdontogram,
  anaProfile,
  anaStatement,
  clinicFixture,
  noStatement,
  noTreatmentPlans,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const INVOICES_PATH = `${PROFILE_PATH}/invoices`;
const BALANCE_PATH = `${PROFILE_PATH}/balance`;
const STATEMENT_PATH = `${PROFILE_PATH}/statement`;
const ROWS = '[data-testid="statement-entry"]';

function profileSections(statement: unknown) {
  return {
    [PROFILE_PATH]: { body: anaProfile },
    [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
    [`${PROFILE_PATH}/treatment-plans`]: { body: noTreatmentPlans },
    [INVOICES_PATH]: { body: anaInvoices },
    [BALANCE_PATH]: { body: anaBalance },
    [STATEMENT_PATH]: { body: statement },
  };
}

test.describe('Patient statement', () => {
  test('is read only when opened, then draws the ledger in order with its balances', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);

    const api = await installApi(page, {
      ...clinicFixture(),
      ...profileSections(anaStatement),
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-statement');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Statement' })).toBeVisible();
    await expect(card.getByText('Every invoice and payment, oldest first')).toBeVisible();

    // The report is not fetched until it is asked for.
    expect(api.requests.filter((url) => url.includes('/statement'))).toEqual([]);
    await expect(card.locator(ROWS)).toHaveCount(0);

    await card.getByTestId('open-statement').click();

    await expect(card.locator(ROWS)).toHaveCount(3);
    expect(api.requests.filter((url) => url.includes('/statement'))).toHaveLength(1);

    // Oldest first, with the server's running balance on every line.
    const rows = card.locator(ROWS);
    await expect(rows.nth(0)).toContainText('Invoice F001-00001');
    await expect(rows.nth(0).getByTestId('statement-entry-amount')).toContainText('230.00 USD');
    await expect(rows.nth(0).getByTestId('statement-entry-balance')).toContainText(
      'Balance 230.00 USD',
    );
    // 02:00Z on the 5th is 21:00 Lima on the 4th — the clinic's clock, not UTC's.
    await expect(rows.nth(0)).toContainText('Oct 4, 2026');

    await expect(rows.nth(1)).toContainText('Payment · CARD · *** 4242');
    await expect(rows.nth(1).getByTestId('statement-entry-amount')).toContainText('-120.00 USD');
    await expect(rows.nth(1).getByTestId('statement-entry-balance')).toContainText(
      'Balance 110.00 USD',
    );

    await expect(rows.nth(2)).toContainText('Invoice F001-00002');
    await expect(rows.nth(2).getByTestId('statement-entry-balance')).toContainText(
      'Balance 230.00 USD',
    );

    // The column totals are the API's, and the closing figure agrees with the
    // Balance card's own server number — 230.00 outstanding.
    await expect(card.getByTestId('statement-billed')).toContainText('350.00 USD');
    await expect(card.getByTestId('statement-paid')).toContainText('120.00 USD');
    await expect(card.getByTestId('statement-closing')).toContainText('230.00 USD');
    await expect(page.getByTestId('patient-balance-value')).toContainText('230.00 USD');

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('says nothing has been billed or paid for an empty history', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      ...profileSections(noStatement),
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-statement');
    await card.getByTestId('open-statement').click();

    await expect(card.getByText('Nothing has been billed or paid yet.')).toBeVisible();
    await expect(card.locator(ROWS)).toHaveCount(0);
    await expect(card.getByTestId('statement-closing')).toHaveCount(0);

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('shows an error state when the statement read fails', async ({ page }) => {
    watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      ...profileSections(anaStatement),
      [STATEMENT_PATH]: { status: 500, body: { message: 'boom' } },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-statement');
    await card.getByTestId('open-statement').click();

    await expect(card.getByRole('alert')).toContainText('The statement could not be loaded.');
    await expect(card.locator(ROWS)).toHaveCount(0);
    await expect(card.getByText('Nothing has been billed or paid yet.')).toHaveCount(0);
  });
});
