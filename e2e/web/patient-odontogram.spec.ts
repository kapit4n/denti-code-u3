/**
 * The odontogram chart on a patient's profile, in a real browser.
 *
 * The API is mocked (see `fixtures/mock-api.ts` for why), so these specs answer
 * presentation questions only: does the chart show what the API returned, does a
 * charted tooth reach the screen only once a refetch has produced it, and does a
 * refusal keep the draft on the form?
 *
 * What the API refuses — a tooth that is not FDI, a dentition that is not the
 * tooth's, a site without a surface, a patient this clinic does not hold — is
 * the API's and the domain's subject, covered against real databases in
 * `apps/api/test` (the SQLite smoke coverage in
 * `sqlite-smoke.integration.test.ts`, and the PostgreSQL right-to-chart cases in
 * `patient-profile-scope.integration.test.ts`).
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  anaOdontogram,
  anaProfile,
  clinicFixture,
  patientOdontogram,
  recordedOdontogramEntry,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, type InstalledApi } from './fixtures/mock-api.js';

const PROFILE_PATH = `/api/v1/patients/${ANA_ID}`;
const CHART_PATH = `${PROFILE_PATH}/odontogram`;

/**
 * The console-error list, minus the browser's own note about a refused response.
 *
 * The refusal spec makes the API answer 422, and Chromium logs that as a console
 * error before the application has had any chance to react — so the raw list is
 * never empty there. What is left after the filter is what must not happen: an
 * uncaught exception or an error the application itself printed.
 */
function expectedResourceFailures(errors: readonly string[]): string[] {
  return errors.filter((text) => !text.startsWith('Failed to load resource'));
}

/** How many times the chart was read (the POST is a different method and path). */
function chartReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) => entry.method === 'GET' && new URL(entry.url).pathname === CHART_PATH,
  ).length;
}

/** The charting sent to the server, or `undefined` when nothing was sent. */
async function writtenCharting(api: InstalledApi): Promise<unknown> {
  return api.recorded.find((request) => request.url.endsWith('/odontogram/entries'))?.body;
}

test.describe('Odontogram chart', () => {
  test('renders the chart and its rows on the profile', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [CHART_PATH]: { body: anaOdontogram },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await expect(page.getByTestId('patient-odontogram')).toBeVisible();

    // The cell carries what the API said about the tooth, not what the component
    // decided: `data-condition` is the row's own `condition`. An uncharted tooth
    // is a plain neutral cell, and just as selectable.
    await expect(page.getByTestId('odontogram-tooth-16')).toHaveAttribute(
      'data-condition',
      'CARIES',
    );
    await expect(page.getByTestId('odontogram-tooth-36')).toHaveAttribute(
      'data-condition',
      'UNCHARTED',
    );

    const entry = page.getByTestId('odontogram-entry');
    await expect(entry).toContainText('Tooth 16');
    await expect(entry).toContainText('CARIES');
    await expect(entry).toContainText('MESIAL');
    await expect(entry).toContainText('Composite patch scheduled.');
    // 13:00Z is 08:00 in Lima. The profile reads its times through the clinic's
    // clock, so the row's hour is the clinic's, not the browser's.
    await expect(entry).toContainText('08:00');
    await expect(entry).not.toContainText('13:00');

    // The chart is asked for when the profile opens, and once only.
    expect(chartReads(api.recorded)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('charts a tooth and shows it only once the server has stored it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [CHART_PATH]: { body: anaOdontogram },
      [`POST ${CHART_PATH}/entries`]: { status: 201, body: recordedOdontogramEntry },
    });

    await page.goto(`/patients/${ANA_ID}`);

    await page.getByTestId('odontogram-tooth-36').click();
    // The form's own confirmation that the map is the picker: the button names
    // the chosen tooth, and nothing but a click on the tooth could put it there.
    await expect(page.getByTestId('record-odontogram-entry')).toHaveText('Chart tooth 36');

    await page.getByTestId('odontogram-condition').selectOption('CROWN');
    await page.getByTestId('record-odontogram-entry').click();

    // The server's answer to the POST is installed before the POST can resolve, so
    // the refetch the mutation triggers reads the chart as it now stands. The row
    // that appears carries the server's own `id` and hour — which is the point:
    // nothing in the browser could have produced them, so nothing but the refetch
    // could have put them on screen.
    await installApi(page, {
      [CHART_PATH]: {
        body: patientOdontogram([{ ...anaOdontogram.entries[0] }, recordedOdontogramEntry]),
      },
    });

    await expect(page.getByTestId('odontogram-tooth-36')).toHaveAttribute(
      'data-condition',
      'CROWN',
    );

    const charted = page.getByTestId('odontogram-entry').filter({ hasText: 'Tooth 36' });
    await expect(charted).toContainText('CROWN');
    // 14:00Z is 09:00 in Lima.
    await expect(charted).toContainText('09:00');
    await expect(charted).not.toContainText('14:00');

    // The body is only the finding: the patient is the path, the tooth's number
    // tells its own dentition, and CROWN describes the whole tooth so it needs no
    // surfaces. A blank note box must leave the `notes` key out of the wire too.
    expect(await writtenCharting(api)).toEqual({
      tooth: '36',
      condition: 'CROWN',
      surfaces: [],
    });

    // Two reads, not one: the section's own, and the one the invalidation asked
    // for. Charting changes nothing about the patient's profile row.
    await expect.poll(() => chartReads(api.recorded)).toBe(2);

    expect(errors).toEqual([]);
  });

  test('keeps the draft when the chart refuses the finding', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...clinicFixture(),
      [PROFILE_PATH]: { body: anaProfile },
      [CHART_PATH]: { body: anaOdontogram },
      [`POST ${CHART_PATH}/entries`]: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A finding must affect at least one surface, or describe the whole tooth',
            requestId: 'req-odontogram-1',
          },
        },
      },
    });

    await page.goto(`/patients/${ANA_ID}`);

    // CARIES is a site, so it must name a surface. The form lets a whole-tooth
    // condition through with none and cannot know the deeper rule by itself, so
    // the server refuses with the domain's own sentence.
    await page.getByTestId('odontogram-tooth-24').click();
    await page.getByTestId('odontogram-condition').selectOption('CARIES');
    await page.getByTestId('odontogram-notes').fill('Watch composite on 24.');
    await page.getByTestId('record-odontogram-entry').click();

    await expect(page.getByRole('alert')).toContainText(
      'A finding must affect at least one surface, or describe the whole tooth',
    );

    // The refusal keeps the draft: the sentence, the tooth and the condition are
    // still there so the clinician can fix the one thing the API objected to.
    await expect(page.getByTestId('odontogram-notes')).toHaveValue('Watch composite on 24.');
    await expect(page.getByTestId('odontogram-condition')).toHaveValue('CARIES');
    await expect(page.getByTestId('record-odontogram-entry')).toHaveText('Chart tooth 24');

    // Nothing was charted and the chart was not asked for again: a refusal does
    // not refetch a chart it did not change.
    expect(await writtenCharting(api)).toEqual({
      tooth: '24',
      condition: 'CARIES',
      surfaces: [],
      notes: 'Watch composite on 24.',
    });
    await expect(page.getByTestId('odontogram-entry').filter({ hasText: 'Tooth 24' })).toHaveCount(
      0,
    );
    expect(chartReads(api.recorded)).toBe(1);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });
});
