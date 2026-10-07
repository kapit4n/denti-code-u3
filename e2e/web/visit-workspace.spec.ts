/**
 * The visit workspace in a real browser, against a mocked API.
 *
 * The unit suite proves the workspace's own sentences — the clinic's clock, the
 * names behind the ids, which buttons exist. What only a browser can see is whether
 * those pieces are wired to each other and to the URL, which is what these specs
 * answer:
 *
 *  1. **A visit opens at its own address, named by the clinic's clock.** The browser
 *     runs on `America/New_York` (see `playwright.config.ts`), so a workspace that
 *     drew the instant in the visitor's zone would show 09:05 for a visit the clinic
 *     began at 08:05 — plausible, wrong, and invisible to a unit test that formats
 *     with the zone it was handed.
 *  2. **A closure is a POST with no body, and the screen then shows the server's
 *     row.** Non-optimistic is a claim about *when* the chip changes, so the spec
 *     asserts the refetch too: the visit is fetched twice, and the second answer is
 *     the one on screen.
 *  3. **A refusal reaches the screen** — the dialog checks nothing itself, so a
 *     domain answer is the only thing that will ever tell a clinician the move was
 *     refused.
 *  4. **The record is the door.** The patient profile's "Recent visits" card links
 *     into the workspace; a visit with no way to reach it is a page only a person
 *     who knows the id could open.
 *  5. **Notes are asked for when their section opens, and a filed note arrives by
 *     refetch.** The list shows the server's `id` and `createdAt` — values no browser
 *     could invent — which is what makes "not optimistic" observable rather than
 *     asserted; and a refused note keeps the clinician's text on screen.
 *
 * What is *not* here: the rules. Which moves are legal is the domain's, tested
 * against the domain and against a real API elsewhere. This file asserts that
 * whatever the domain said reaches the screen.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  COMPLETED_VISIT_ID,
  VISIT_ID,
  anaProfile,
  filedNote,
  openVisit,
  visitNote,
  visitWorkspaceFixtures,
} from './fixtures/api-responses.js';
import { watchForConsoleErrors } from './fixtures/console-errors.js';
import { installApi, notFound } from './fixtures/mock-api.js';

/**
 * The console-error list, minus the browser's own notes about a failing response.
 *
 * This file deliberately makes endpoints answer 409 and 404, and Chromium logs
 * each one as a console error before the application has had any chance to react —
 * so the raw list is never empty here even when every assertion above passes. What
 * is left after the filter is what must not happen: an uncaught exception or an
 * error the application itself printed.
 */
function expectedResourceFailures(errors: readonly string[]): string[] {
  return errors.filter((text) => !text.startsWith('Failed to load resource'));
}

/** What the open visit becomes once the API has applied the closure. */
const CLOSED_VISIT = { ...openVisit, status: 'COMPLETED', endedAt: '2026-10-06T14:05:00.000Z' };

/** How many times the workspace has asked for its own visit (the POST is a different path). */
function visitReads(requests: readonly string[]): number {
  return requests.filter((url) => new URL(url).pathname === `/api/v1/visits/${VISIT_ID}`).length;
}

/** How many times the notes were read — one when the section opened, one after the mutation. */
function notesReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) =>
      entry.method === 'GET' && new URL(entry.url).pathname === `/api/v1/visits/${VISIT_ID}/notes`,
  ).length;
}

test.describe('Visit workspace', () => {
  test('shows an open visit in the clinic’s clock, with names behind the ids', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, visitWorkspaceFixtures());

    await page.goto(`/visits/${VISIT_ID}`);

    await expect(page.getByRole('heading', { name: 'Ana García' })).toBeVisible();
    await expect(page.getByTestId('visit-status')).toHaveText('Open');
    await expect(page.getByText('P-000001 · Started from a booking')).toBeVisible();

    // 13:05Z is 08:05 in Lima and 09:05 in this browser's New York. The clinic's
    // hour is on screen, and the browser's is nowhere on it.
    await expect(page.getByTestId('visit-workspace')).toContainText('08:05');
    await expect(page.getByTestId('visit-workspace')).not.toContainText('09:05');
    await expect(page.getByText('Not finished yet')).toBeVisible();

    // Names, not uuids: the visit carries ids, and the lists are what answer them.
    await expect(page.getByText('Dra. Rivera')).toBeVisible();
    await expect(page.getByText('Sillón 1 · Sala 1')).toBeVisible();
    await expect(page.getByText('No clinical summary recorded.')).toBeVisible();

    // A button for a closure the API does not implement would be a control that
    // 404s; OPEN may be completed, and nothing else here has a door.
    await expect(page.getByTestId('complete-visit')).toBeVisible();
    await expect(page.getByTestId('reopen-visit')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('completes a visit and redraws from the server’s answer', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`POST /api/v1/visits/${VISIT_ID}/complete`]: { body: CLOSED_VISIT },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await expect(page.getByTestId('complete-visit')).toBeVisible();
    expect(visitReads(api.requests)).toBe(1);

    await page.getByTestId('complete-visit').click();

    // The server's row is installed the moment the POST is on the wire and before it
    // can resolve: the refetch the closure triggers is a round trip away, and this is
    // the answer it has to come back with. Anything earlier would rewrite a read the
    // page has already made.
    await installApi(page, { [`/api/v1/visits/${VISIT_ID}`]: { body: CLOSED_VISIT } });

    await expect(page.getByTestId('visit-status')).toHaveText('Completed');
    await expect(page.getByTestId('reopen-visit')).toBeVisible();
    await expect(page.getByTestId('complete-visit')).toHaveCount(0);

    // Bodyless, both ways: the endpoint reads nothing, and a JSON body it never
    // parses is a place a client could believe a field was accepted.
    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/complete`),
    );
    expect(post).toBeTruthy();
    expect(post?.body).toBeUndefined();

    // The chip did not change because a mutation handed the component a row: the
    // visit was read again, which is what the invalidation is for.
    await expect.poll(() => visitReads(api.requests)).toBeGreaterThan(1);

    expect(errors).toEqual([]);
  });

  test('shows the server’s refusal and leaves the visit as it is', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(
      page,
      visitWorkspaceFixtures({
        [`POST /api/v1/visits/${VISIT_ID}/complete`]: {
          status: 409,
          body: {
            error: {
              code: 'DOMAIN_RULE_VIOLATION',
              message: 'Visit cannot move from OPEN to COMPLETED',
              requestId: 'e2e',
            },
          },
        },
      }),
    );

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('complete-visit').click();

    // The wire code collapses every rule refusal into one, so the message is the
    // only part that says why — and the record underneath still says Open.
    await expect(page.getByRole('alert')).toHaveText(/Visit cannot move from OPEN to COMPLETED/);
    await expect(page.getByTestId('visit-status')).toHaveText('Open');

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('says a visit this clinic does not hold is not here', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, visitWorkspaceFixtures({ [`/api/v1/visits/${VISIT_ID}`]: notFound() }));

    await page.goto(`/visits/${VISIT_ID}`);

    await expect(page.getByText('This visit does not exist in the current clinic.')).toBeVisible();
    await expect(page.getByRole('link', { name: /All patients/ })).toBeVisible();
    await expect(page.getByTestId('visit-workspace')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('is reached from the patient’s record, with the history that linked to it', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures(),
      [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
    });

    await page.goto(`/patients/${ANA_ID}`);

    // The reason the card gives, because it is the text a person would recognise —
    // the date above it is formatted and therefore not the thing to key on.
    await page.getByRole('link', { name: /Sensitivity in the upper right quadrant/ }).click();

    await expect(page).toHaveURL(new RegExp(`/visits/${COMPLETED_VISIT_ID}$`));
    await expect(page.getByRole('heading', { name: 'Ana García' })).toBeVisible();
    await expect(page.getByTestId('visit-status')).toHaveText('Completed');

    // The summary the profile reported is the one the workspace shows: same row, two
    // screens, and a fixture that disagreed would be an API that disagreed.
    await expect(page.getByText('Composite restoration on tooth 16.')).toBeVisible();
    await expect(page.getByTestId('reopen-visit')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('files a clinical note, and shows it only once the server has stored it', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/notes`]: { body: { notes: [visitNote] } },
        [`POST /api/v1/visits/${VISIT_ID}/notes`]: { body: filedNote, status: 201 },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);

    // The summary is what the workspace opens on, and the notes were not asked for
    // until somebody asked to see them.
    await expect(page.getByTestId('visit-workspace')).toBeVisible();
    expect(notesReads(api.recorded)).toBe(0);

    await page.getByTestId('visit-section-notes').click();

    // 13:00Z is 08:00 in Lima: a note's time is the clinic's clock again, on a row
    // nothing but the endpoint could have produced.
    await expect(page.getByTestId('clinical-note').first()).toContainText(visitNote.body);
    await expect(page.getByTestId('clinical-note').first()).toContainText('08:00');
    await expect(page.getByTestId('clinical-note').first()).not.toContainText('13:00');

    await page.getByTestId('note-body').fill(filedNote.body);
    await page.getByTestId('add-note').click();

    // The server's answer to the POST is installed before the POST can resolve, so
    // the refetch the mutation triggers reads the note list as it now stands. The
    // row that appears carries the server's own `id` — which is the point: nothing
    // in the browser could have produced it, so nothing but the refetch could have
    // put it on screen.
    await installApi(page, {
      [`/api/v1/visits/${VISIT_ID}/notes`]: { body: { notes: [visitNote, filedNote] } },
    });

    const filed = page
      .getByTestId('clinical-note')
      .filter({ hasText: 'Referred for endodontic assessment.' });
    await expect(filed).toBeVisible();
    await expect(filed).toContainText('08:00');
    await expect(page.getByTestId('note-body')).toHaveValue('');

    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/notes`),
    );
    expect(post).toBeTruthy();
    expect(post?.body).toEqual({ body: filedNote.body });

    // Two reads, not one: the section's own, and the one the invalidation asked for.
    await expect.poll(() => notesReads(api.recorded)).toBe(2);

    expect(errors).toEqual([]);
  });

  test('keeps what the clinician typed when the note is refused', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/notes`]: { body: { notes: [] } },
        [`POST /api/v1/visits/${VISIT_ID}/notes`]: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'A note needs a body',
              requestId: 'e2e',
            },
          },
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-notes').click();
    await expect(page.getByText('No notes yet.')).toBeVisible();

    await page.getByTestId('note-body').fill('Half a thought');
    await page.getByTestId('add-note').click();

    // The refusal reaches the screen in the API's own words (the wire code collapses
    // every refusal, so the message is the only part that says why), and the text is
    // still in the box — a failed request that took the paragraph with it would be
    // the most destructive thing this panel does.
    await expect(page.getByRole('alert')).toHaveText(/A note needs a body/);
    await expect(page.getByTestId('note-body')).toHaveValue('Half a thought');
    await expect(page.getByTestId('clinical-note')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });
});
