/**
 * Patient balance — the "Patient balances, statements" slice.
 *
 * The profile opens and the Balance card mounts: with a patient who owes it shows
 * the amount, names it "Outstanding", and prints the server's own five figures
 * under it. A patient who owes nothing says so in words rather than showing a bare
 * zero, and an unapplied payment is drawn as the credit it is. A failed read is an
 * error box, not a zero — "nothing owed" and "could not tell" must not look the
 * same on a billing screen.
 *
 * The figures are the API's, never the browser's: the spec hands the card the same
 * five numbers the domain adds up over the documents and the money, and asserts the
 * card draws them rather than re-deriving them from the invoice list beside it.
 */
import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaBalance,
  anaOdontogram,
  anaProfile,
  anaInvoices,
  clinicFixture,
  noInvoices,
  noTreatmentPlans,
  settledBalance,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const INVOICES_PATH = `${PROFILE_PATH}/invoices`;
const BALANCE_PATH = `${PROFILE_PATH}/balance`;

/**
 * The profile mounts every section at once, so a spec about one of them must still
 * answer the others — an unregistered path is a 501 the browser logs.
 */
function profileSections(balance: unknown) {
  return {
    [PROFILE_PATH]: { body: anaProfile },
    [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
    [`${PROFILE_PATH}/treatment-plans`]: { body: noTreatmentPlans },
    [INVOICES_PATH]: { body: anaInvoices },
    [BALANCE_PATH]: { body: balance },
  };
}

test.describe('Patient balance', () => {
  test('shows what is owed, named, with the five figures underneath', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, { ...clinicFixture(), ...profileSections(anaBalance) });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-balance');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Balance' })).toBeVisible();
    await expect(card.getByText('What this patient owes this clinic')).toBeVisible();

    await expect(card.getByTestId('patient-balance-value')).toContainText('230.00 USD');
    await expect(card.getByTestId('patient-balance-state')).toContainText('Outstanding');

    await expect(card.getByTestId('patient-balance-billed')).toContainText('350.00 USD');
    await expect(card.getByTestId('patient-balance-allocated')).toContainText('120.00 USD');
    await expect(card.getByTestId('patient-balance-outstanding')).toContainText('230.00 USD');

    // A settled ledger has no unapplied money, so the credit row is not drawn.
    await expect(card.getByTestId('patient-balance-unallocated')).toHaveCount(0);

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('says nothing is owed rather than showing a bare zero', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, { ...clinicFixture(), ...profileSections(settledBalance) });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-balance');
    await expect(card.getByTestId('patient-balance-value')).toContainText('0.00 USD');
    await expect(card.getByTestId('patient-balance-state')).toContainText('Nothing owed');

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('names money in credit as credit, with the payments behind it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      ...profileSections({
        currency: 'USD',
        billedMinor: 12000,
        allocatedMinor: 12000,
        outstandingMinor: 0,
        unallocatedPaymentsMinor: 5000,
        balanceMinor: -5000,
      }),
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-balance');
    await expect(card.getByTestId('patient-balance-value')).toContainText('-50.00 USD');
    await expect(card.getByTestId('patient-balance-state')).toContainText('Credit on account');
    await expect(card.getByTestId('patient-balance-unallocated')).toContainText('50.00 USD');

    expect(errors.filter((e) => e.includes('Failed to load resource'))).toEqual([]);
  });

  test('shows an error state when the balance read fails', async ({ page }) => {
    watchForConsoleErrors(page);

    await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [`${PROFILE_PATH}/odontogram`]: { body: anaOdontogram },
      [`${PROFILE_PATH}/treatment-plans`]: { body: noTreatmentPlans },
      [INVOICES_PATH]: { body: noInvoices },
      [BALANCE_PATH]: { status: 500, body: { message: 'boom' } },
    });

    await page.goto(`/patients/${ANA_ID}`);

    const card = page.getByTestId('patient-balance');
    await expect(card).toBeVisible();
    await expect(card.getByRole('alert')).toContainText('The balance could not be loaded.');
    await expect(card.getByTestId('patient-balance-value')).toHaveCount(0);
  });
});
