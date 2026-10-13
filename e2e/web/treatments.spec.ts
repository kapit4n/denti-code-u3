/**
 * The treatment catalogue page, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * presentation questions only: does the catalogue draw what the API returned, is
 * a price shown as money rather than as the integer it is stored as, does a
 * treatment reach the list only after a refetch has produced it, and does a
 * refusal keep the draft.
 *
 * What the API refuses — a blank name, a code this clinic already offers, a
 * duration of zero — is the API's and the domain's subject, covered against real
 * databases in `apps/api/test` (the SQLite smoke coverage in
 * `sqlite-smoke.integration.test.ts`).
 */

import { expect, test } from './fixtures/frozen-clock.js';

import { createdTreatment, treatmentsCatalogue } from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, type InstalledApi } from './fixtures/mock-api.js';

const CATALOGUE_PATH = '/api/v1/treatments';

/** The catalogue POSTs a spec filed, as the client actually sent it. */
function filedTreatment(api: InstalledApi): unknown {
  return api.recorded.find(
    (request) => request.method === 'POST' && new URL(request.url).pathname === CATALOGUE_PATH,
  )?.body;
}

/**
 * The console-error list, minus the browser's own note about a refused response.
 *
 * The refusal spec makes the API answer 409, and Chromium logs that as a console
 * error before the application has had any chance to react — so the raw list is
 * never empty there. What is left after the filter is what must not happen: an
 * uncaught exception or an error the application itself printed.
 */
function expectedResourceFailures(errors: readonly string[]): string[] {
  return errors.filter((text) => !text.startsWith('Failed to load resource'));
}

test.describe('Treatment catalogue', () => {
  test('draws the catalogue, with prices as money and not as cents', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      [CATALOGUE_PATH]: { body: treatmentsCatalogue },
    });

    await page.goto('/treatments');

    const row = page
      .getByTestId('treatment-catalogue-item')
      .filter({ hasText: 'Composite restoration' });
    await expect(row).toContainText('COMPO-ANT');
    await expect(row).toContainText('45 min');
    // 30000 minor units is 300.00 — a client that printed the column would show
    // "30000" here, and the row would still look like a row.
    await expect(row).toContainText('300.00');
    await expect(row).not.toContainText('30000');
    await expect(page.getByText('2 treatments offered')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('files a treatment and lists it only once the server has answered', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      [CATALOGUE_PATH]: { body: treatmentsCatalogue },
      [`POST ${CATALOGUE_PATH}`]: { status: 201, body: createdTreatment },
    });

    await page.goto('/treatments');

    await page.getByTestId('treatment-name').fill('Apicoectomy');
    await page.getByTestId('treatment-code').fill('ENDO-APICO');
    await page.getByTestId('treatment-description').fill('Surgical removal of a tooth root tip.');
    await page.getByTestId('treatment-duration').fill('90');
    await page.getByTestId('treatment-price').fill('750.00');

    // Swapped in before the click rather than after it. The catalogue has already
    // been read once, so nothing on screen changes here — but the refetch the
    // mutation triggers is a round trip away, and installing the answer
    // beforehand is the only way to be sure which fixture that refetch meets.
    await installApi(page, {
      [CATALOGUE_PATH]: { body: { items: [...treatmentsCatalogue.items, createdTreatment] } },
    });

    await page.getByTestId('add-treatment').click();

    // The body is the request's, not the form's: the price crossed the wire as
    // the integer of cents it was parsed to, and nothing the schema does not
    // know about rode along with it.
    await expect
      .poll(() => filedTreatment(api))
      .toEqual({
        code: 'ENDO-APICO',
        name: 'Apicoectomy',
        description: 'Surgical removal of a tooth root tip.',
        defaultDurationMinutes: 90,
        defaultPriceMinor: 75_000,
      });

    // The row that appears carries the server's own `id` — nothing in the browser
    // could have produced it, so nothing but the refetch could have listed it.
    const created = page.getByTestId('treatment-catalogue-item').filter({ hasText: 'Apicoectomy' });
    await expect(created).toBeVisible();
    await expect(created).toContainText('ENDO-APICO');
    await expect(created).toContainText('750.00');
    await expect(page.getByText('3 treatments offered')).toBeVisible();

    // And the form that filed it is empty again — but only now that it was taken.
    await expect(page.getByTestId('treatment-name')).toHaveValue('');

    expect(errors).toEqual([]);
  });

  test('keeps the whole draft when the API refuses the treatment', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      [CATALOGUE_PATH]: { body: treatmentsCatalogue },
      [`POST ${CATALOGUE_PATH}`]: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'That code is already in the catalogue',
            requestId: 'req-treatment-1',
          },
        },
      },
    });

    await page.goto('/treatments');

    await page.getByTestId('treatment-name').fill('Scaling and prophylaxis');
    await page.getByTestId('treatment-code').fill('COMPO-ANT');
    await page.getByTestId('treatment-price').fill('90.00');
    await page.getByTestId('add-treatment').click();

    // The duplicate code reaches the client folded into DOMAIN_RULE_VIOLATION, so
    // the server's own sentence is all the person gets — and it names the code.
    await expect(page.getByRole('alert')).toContainText('That code is already in the catalogue');

    // The refusal keeps the draft: everything typed is still there, so the one
    // thing the API objected to can be fixed rather than retyped.
    await expect(page.getByTestId('treatment-name')).toHaveValue('Scaling and prophylaxis');
    await expect(page.getByTestId('treatment-code')).toHaveValue('COMPO-ANT');
    await expect(page.getByTestId('treatment-price')).toHaveValue('90.00');

    // Nothing was filed, and the catalogue was not asked for again.
    await expect(page.getByTestId('treatment-catalogue-item')).toHaveCount(2);

    // The 409 is Chromium's own "Failed to load resource" note, logged before the
    // application can react; what must not happen is anything else.
    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('refuses a nameless treatment at the boundary, without asking the server', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      [CATALOGUE_PATH]: { body: treatmentsCatalogue },
    });

    await page.goto('/treatments');

    await page.getByTestId('treatment-code').fill('NO-NAME');
    await page.getByTestId('add-treatment').click();

    await expect(page.getByText('A treatment needs a name')).toBeVisible();
    // One read (the page's own) and no POST: a shape the boundary already knows
    // about is not a round trip.
    expect(api.recorded.filter((request) => request.method === 'POST')).toHaveLength(0);

    expect(errors).toEqual([]);
  });
});
