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
 *  6. **Prescriptions follow the same discipline as notes and treatments**: asked for
 *     when their section opens (never before), written non-optimistically (the row
 *     appears by refetch, carrying the server's `issuedAt`), and kept on screen
 *     when refused.
 *  7. **Charges too, with money on the wire**: the boxes leave as integer minor
 *     units, the row appears only by refetch (the mock's read fixture is swapped
 *     between the section's first fetch and the write, so the refetch is the only
 *     possible source of it), and a refusal keeps the front desk's draft.
 *  8. **Payments close on the charges**: a payment is asked for when its section
 *     opens, arrives by refetch carrying the server's own `id` and `receivedAt`,
 *     and — because a settlement stamps the bill invoiced — closes the door it
 *     came through, with the still-there-balance told out loud.
 *  9. **Files are asked for when their section opens, and an attached file arrives
 *     by refetch.** The list shows the server's `fileName` and `createdAt` — the
 *     latter read in the clinic's clock — and a refused file keeps the front
 *     desk's draft on screen.
 *
 * What is *not* here: the rules. Which moves are legal is the domain's, tested
 * against the domain and against a real API elsewhere. This file asserts that
 * whatever the domain said reaches the screen.
 */

import { expect, test } from './fixtures/frozen-clock.js';

import {
  ANA_ID,
  COMPLETED_VISIT_ID,
  PROPHYLAXIS_TREATMENT_ID,
  VISIT_ID,
  anaProfile,
  existingVisitTreatment,
  filedNote,
  filedPrescription,
  invoicedCharge,
  openVisit,
  recordedPayment,
  recordedTreatment,
  treatmentsCatalogue,
  visitNote,
  visitPayment,
  visitPayments,
  visitPrescription,
  visitPrescriptions,
  visitTreatments,
  visitWorkspaceFixtures,
  visitCharge,
  visitCharges,
  raisedCharge,
  attachedFile,
  visitAttachment,
  visitAttachments,
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

/** How many times this visit's treatments were read — one on open, one after the record. */
function treatmentsReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) =>
      entry.method === 'GET' &&
      new URL(entry.url).pathname === `/api/v1/visits/${VISIT_ID}/treatments`,
  ).length;
}

/**
 * How many times this visit's prescriptions were read — one when the section opened,
 * one after the write.
 */
function prescriptionsReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) =>
      entry.method === 'GET' &&
      new URL(entry.url).pathname === `/api/v1/visits/${VISIT_ID}/prescriptions`,
  ).length;
}

/**
 * How many times this visit's charges were read — one when the section opened,
 * one after the write. The spec's whole claim about non-optimism rests on this
 * number and on what the second answer carried.
 */
function chargesReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) =>
      entry.method === 'GET' &&
      new URL(entry.url).pathname === `/api/v1/visits/${VISIT_ID}/charges`,
  ).length;
}

/**
 * How many times this visit's payments were read — one when the section opened,
 * another after the write. The spec's claim about non-optimism rests on this number
 * and on what the second answer carried.
 */
function paymentsReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) =>
      entry.method === 'GET' &&
      new URL(entry.url).pathname === `/api/v1/visits/${VISIT_ID}/payments`,
  ).length;
}

/**
 * How many times the files were read — one when the section opened, one after the
 * write. The spec's claim about non-optimism rests on this number and on what the
 * second answer carried.
 */
function attachmentsReads(
  recorded: readonly { readonly method: string; readonly url: string }[],
): number {
  return recorded.filter(
    (entry) =>
      entry.method === 'GET' &&
      new URL(entry.url).pathname === `/api/v1/visits/${VISIT_ID}/attachments`,
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

  test('records a treatment and shows it only once the server has stored it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        '/api/v1/treatments': { body: treatmentsCatalogue },
        [`/api/v1/visits/${VISIT_ID}/treatments`]: {
          body: visitTreatments([existingVisitTreatment]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/treatments`]: { body: recordedTreatment, status: 201 },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);

    // The summary is what the workspace opens on; neither the catalogue nor the
    // treatments were asked for until somebody asked to see them.
    await expect(page.getByTestId('visit-workspace')).toBeVisible();
    expect(treatmentsReads(api.recorded)).toBe(0);

    await page.getByTestId('visit-section-treatments').click();

    // The name on screen is resolved from the catalogue — the record carries an id —
    // and 13:00Z is 08:00 in Lima: the clinic's clock again, on a row nothing but the
    // endpoint could have produced.
    const existing = page
      .getByTestId('treatment-record')
      .filter({ hasText: 'Composite placed on 16' });
    await expect(existing).toContainText('Composite restoration — anterior');
    await expect(existing).toContainText('Tooth 16');
    await expect(existing).toContainText('08:00');
    await expect(existing).not.toContainText('13:00');

    await page.getByTestId('treatment-catalogue').click();
    await page.getByRole('option', { name: /Scaling and prophylaxis/ }).click();
    await page.getByTestId('treatment-tooth').fill('26');
    await page.getByTestId('treatment-notes').fill('Full-mouth cleaning.');
    await page.getByTestId('record-treatment').click();

    // The server's answer to the POST is installed before the POST can resolve, so
    // the refetch the mutation triggers reads the records as they now stand. The row
    // that appears carries the server's own `id` — which is the point: nothing in the
    // browser could have produced it, so nothing but the refetch could have put it on
    // screen.
    await installApi(page, {
      [`/api/v1/visits/${VISIT_ID}/treatments`]: {
        body: visitTreatments([existingVisitTreatment, recordedTreatment]),
      },
    });

    const filed = page.getByTestId('treatment-record').filter({ hasText: 'Full-mouth cleaning.' });
    await expect(filed).toContainText('Scaling and prophylaxis');
    await expect(filed).toContainText('Tooth 26');
    await expect(filed).toContainText('08:35');
    await expect(page.getByTestId('treatment-tooth')).toHaveValue('');
    await expect(page.getByTestId('treatment-notes')).toHaveValue('');

    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/treatments`),
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, dropped when blank — the writer sends what we store.
    expect(post?.body).toEqual({
      treatmentId: PROPHYLAXIS_TREATMENT_ID,
      tooth: '26',
      notes: 'Full-mouth cleaning.',
    });

    // Two reads, not one: the section's own, and the one the invalidation asked for.
    await expect.poll(() => treatmentsReads(api.recorded)).toBe(2);

    expect(errors).toEqual([]);
  });

  test('keeps what the clinician chose when the treatment is refused', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures({
        '/api/v1/treatments': { body: treatmentsCatalogue },
        [`/api/v1/visits/${VISIT_ID}/treatments`]: { body: visitTreatments([]) },
        [`POST /api/v1/visits/${VISIT_ID}/treatments`]: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: '"99" is not a valid FDI tooth number',
              requestId: 'e2e',
            },
          },
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-treatments').click();
    await expect(page.getByText('No treatments recorded yet.')).toBeVisible();

    await page.getByTestId('treatment-catalogue').click();
    await page.getByRole('option', { name: /Scaling and prophylaxis/ }).click();
    await page.getByTestId('treatment-tooth').fill('99');
    await page.getByTestId('record-treatment').click();

    // The refusal reaches the screen in the API's own words (the wire code collapses
    // every refusal, so the message is the only part that says why), and the choice is
    // still there — a failed request that took the clinician's selection with it would
    // be the most destructive thing this panel does.
    await expect(page.getByRole('alert')).toHaveText(/"99" is not a valid FDI tooth number/);
    await expect(page.getByTestId('treatment-tooth')).toHaveValue('99');
    await expect(page.getByTestId('treatment-record')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('files a prescription and shows it only once the server has stored it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/prescriptions`]: {
          body: visitPrescriptions([visitPrescription]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/prescriptions`]: {
          body: filedPrescription,
          status: 201,
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);

    // The summary is what the workspace opens on, and the prescriptions were not
    // asked for until somebody asked to see them.
    await expect(page.getByTestId('visit-workspace')).toBeVisible();
    expect(prescriptionsReads(api.recorded)).toBe(0);

    await page.getByTestId('visit-section-prescriptions').click();

    // The names and the durations are the workspace's rendering of the row's facts,
    // and 13:00Z is 08:00 in Lima: the clinic's clock again, on a row nothing but the
    // endpoint could have produced.
    const existing = page.getByTestId('prescription').filter({ hasText: 'Ibuprofen' });
    await expect(existing).toContainText('Ibuprofen · 400 mg');
    await expect(existing).toContainText('Oral · Every 8 hours as needed');
    await expect(existing).toContainText('· 5 days');
    await expect(existing).toContainText('Take after meals.');
    await expect(existing).toContainText('08:00');
    await expect(existing).not.toContainText('13:00');

    await page.getByTestId('prescription-medication').fill('Amoxicillin');
    await page.getByTestId('prescription-dosage').fill('500 mg');
    await page.getByTestId('prescription-route').click();
    await page.getByRole('option', { name: /Oral/ }).click();
    await page.getByTestId('prescription-frequency').fill('Every 12 hours');
    await page.getByTestId('prescription-duration').fill('7');
    await page.getByTestId('prescription-instructions').fill('Complete the whole course.');
    await page.getByTestId('write-prescription').click();

    // The server's answer to the POST is installed before the POST can resolve, so
    // the refetch the mutation triggers reads the prescriptions as they now stand. The
    // row that appears carries the server's own `id` and `issuedAt` — which is the
    // point: nothing in the browser could have produced them, so nothing but the
    // refetch could have put it on screen.
    await installApi(page, {
      [`/api/v1/visits/${VISIT_ID}/prescriptions`]: {
        body: visitPrescriptions([visitPrescription, filedPrescription]),
      },
    });

    const filed = page.getByTestId('prescription').filter({ hasText: 'Amoxicillin' });
    await expect(filed).toContainText('Amoxicillin · 500 mg');
    await expect(filed).toContainText('· 7 days');
    await expect(page.getByTestId('prescription-medication')).toHaveValue('');
    await expect(page.getByTestId('prescription-duration')).toHaveValue('');
    await expect(page.getByTestId('prescription-route')).toContainText('Choose a route');

    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/prescriptions`),
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, dropped when blank — the writer sends what we store.
    expect(post?.body).toEqual({
      medication: 'Amoxicillin',
      dosage: '500 mg',
      route: 'ORAL',
      frequency: 'Every 12 hours',
      durationDays: 7,
      instructions: 'Complete the whole course.',
    });

    // Two reads, not one: the section's own, and the one the invalidation asked for.
    await expect.poll(() => prescriptionsReads(api.recorded)).toBe(2);

    expect(errors).toEqual([]);
  });

  test('keeps what the clinician typed when the prescription is refused', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/prescriptions`]: {
          body: visitPrescriptions([]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/prescriptions`]: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'A prescription needs a medication name',
              requestId: 'e2e',
            },
          },
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-prescriptions').click();
    await expect(page.getByText('No prescriptions written yet.')).toBeVisible();

    await page.getByTestId('prescription-medication').fill('Ibuprofen');
    await page.getByTestId('prescription-dosage').fill('400 mg');
    await page.getByTestId('prescription-route').click();
    await page.getByRole('option', { name: /Oral/ }).click();
    await page.getByTestId('prescription-frequency').fill('Every 8 hours');
    await page.getByTestId('prescription-duration').fill('5');
    await page.getByTestId('write-prescription').click();

    // The refusal reaches the screen in the API's own words (the wire code collapses
    // every refusal, so the message is the only part that says why), and the draft is
    // still there — a failed request that took the clinician's course with it would be
    // the most destructive thing this panel does.
    await expect(page.getByRole('alert')).toHaveText(/A prescription needs a medication name/);
    await expect(page.getByTestId('prescription-medication')).toHaveValue('Ibuprofen');
    await expect(page.getByTestId('prescription')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('lists charges on the visit only once the section is open', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/charges`]: {
          body: visitCharges([visitCharge]),
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await expect(page.getByTestId('visit-workspace')).toBeVisible();

    // The summary is what the workspace opens on, and the charges were not asked
    // for until somebody asked to see them.
    expect(chargesReads(api.recorded)).toBe(0);

    await page.getByTestId('visit-section-charges').click();

    // 13:10Z is 08:10 in Lima: the clinic's clock again, and a line total drawn
    // by the domain's own arithmetic — 85.00, in the charge's own currency.
    await expect(page.getByTestId('charge')).toBeVisible();
    await expect(page.getByTestId('charge')).toContainText('Composite restoration');
    await expect(page.getByTestId('charge-total')).toContainText('85.00');
    await expect(page.getByTestId('charge')).toContainText('08:10');
    await expect(page.getByTestId('charge')).not.toContainText('13:10');
    await expect(page.getByTestId('charges-total')).toContainText('85.00');

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('raises a charge and shows it after the server answers', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/charges`]: {
          body: visitCharges([]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/charges`]: {
          status: 201,
          body: raisedCharge,
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-charges').click();
    await expect(page.getByText('No charges raised yet.')).toBeVisible();
    expect(chargesReads(api.recorded)).toBe(1);

    // The mock answers reads statically, so without this the refetch after the
    // POST would keep returning the empty list. Swapping the read fixture after
    // the section's own first fetch — and before the write — is what makes the
    // invalidation the observable source of the row: nothing on screen could have
    // come from anything but that second answer.
    await installApi(page, {
      [`GET /api/v1/visits/${VISIT_ID}/charges`]: {
        body: visitCharges([raisedCharge]),
      },
    });

    await page.getByTestId('charge-description').fill('  Composite  ');
    await page.getByTestId('charge-unit-price').fill('85.00');
    await page.getByTestId('charge-quantity').fill('2');
    await page.getByTestId('raise-charge').click();

    const row = page.getByTestId('charge').filter({ hasText: 'Composite' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('08:35');
    await expect(row).not.toContainText('13:35');
    await expect(page.getByTestId('charge-total')).toContainText('170.00');
    await expect(page.getByTestId('charges-total')).toContainText('170.00');
    await expect(page.getByTestId('charge-description')).toHaveValue('');

    // Money leaves the boxes as integer minor units, description trimmed, and
    // nothing the caller does not get to choose (currency, tax, ids) is sent.
    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/charges`),
    );
    expect(post).toBeTruthy();
    expect(post?.body).toEqual({ description: 'Composite', quantity: 2, unitPriceMinor: 8500 });

    // Two reads, not one: the section's own, and the one the invalidation asked for.
    await expect.poll(() => chargesReads(api.recorded)).toBe(2);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('keeps the draft when a charge is refused', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/charges`]: {
          body: visitCharges([]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/charges`]: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'A charge needs a description',
              requestId: 'e2e',
            },
          },
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-charges').click();
    await expect(page.getByText('No charges raised yet.')).toBeVisible();

    await page.getByTestId('charge-description').fill('Cleaning');
    await page.getByTestId('charge-unit-price').fill('85.00');
    await page.getByTestId('raise-charge').click();

    // The refusal reaches the screen in the API's own words, and the price the
    // front desk typed is still in the boxes — a failed request that cleared them
    // would be the most destructive thing this panel does.
    await expect(page.getByRole('alert')).toHaveText(/A charge needs a description/);
    await expect(page.getByTestId('charge-description')).toHaveValue('Cleaning');
    await expect(page.getByTestId('charge-unit-price')).toHaveValue('85.00');
    await expect(page.getByTestId('charge')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('lists payments on the visit only once the section is open', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/charges`]: {
          body: visitCharges([invoicedCharge]),
        },
        [`/api/v1/visits/${VISIT_ID}/payments`]: {
          body: visitPayments([visitPayment]),
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await expect(page.getByTestId('visit-workspace')).toBeVisible();

    // The summary is what the workspace opens on, and the payments were not asked
    // for until somebody asked to see them.
    expect(paymentsReads(api.recorded)).toBe(0);

    await page.getByTestId('visit-section-payments').click();

    // 13:20Z is 08:20 in Lima: the clinic's clock again, on a receipt nothing but
    // the endpoint could have produced.
    const row = page.getByTestId('payment').filter({ hasText: 'Card' });
    await expect(row).toContainText('4242');
    await expect(row).toContainText('85.00');
    await expect(row).toContainText('08:20');
    await expect(row).not.toContainText('13:20');

    // The bill the register settles against is drawn beside it: 85.00 billed, 85.00
    // paid, nothing left — and the door a settlement would open is closed, because
    // the money covered the whole bill.
    await expect(page.getByTestId('payments-billed')).toHaveText('85.00');
    await expect(page.getByTestId('payments-paid')).toHaveText('85.00');
    await expect(page.getByTestId('payments-still-to-pay')).toHaveText('0.00');
    await expect(page.getByText(/fully settled/)).toBeVisible();

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('records a payment and shows it after the server answers', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/charges`]: {
          body: visitCharges([visitCharge]),
        },
        [`/api/v1/visits/${VISIT_ID}/payments`]: {
          body: visitPayments([]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/payments`]: {
          status: 201,
          body: recordedPayment,
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-payments').click();
    await expect(page.getByText('No payments recorded yet.')).toBeVisible();

    // Billed 85.00, nothing paid yet, nothing left outstanding.
    await expect(page.getByTestId('payments-billed')).toHaveText('85.00');
    await expect(page.getByTestId('payments-paid')).toHaveText('0.00');
    await expect(page.getByTestId('payments-still-to-pay')).toHaveText('85.00');

    // The mock answers reads statically, so without this the refetch after the POST
    // would keep returning the empty register and the un-invoiced bill. Swapping
    // both read fixtures after the section's own fetches — and before the write —
    // is what makes the invalidation the observable source of the new row: nothing
    // on screen could have come from anything but those second answers.
    await installApi(page, {
      [`GET /api/v1/visits/${VISIT_ID}/charges`]: {
        body: visitCharges([invoicedCharge]),
      },
      [`GET /api/v1/visits/${VISIT_ID}/payments`]: {
        body: visitPayments([recordedPayment]),
      },
    });

    await page.getByTestId('payment-amount').fill('55.00');
    await page.getByTestId('payment-method').click();
    await page.getByRole('option', { name: /Cash/ }).click();
    await page.getByTestId('record-payment').click();

    // Money leaves the box as integer minor units, the method is sent, and the row
    // that appears carries the server's own `receivedAt` — nothing in the browser
    // could have produced it, so nothing but the refetch could have put it on screen.
    const row = page.getByTestId('payment').filter({ hasText: 'Cash' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('55.00');
    await expect(row).toContainText('08:45');
    await expect(row).not.toContainText('13:45');

    await expect(page.getByTestId('payments-billed')).toHaveText('85.00');
    await expect(page.getByTestId('payments-paid')).toHaveText('55.00');
    await expect(page.getByTestId('payments-still-to-pay')).toHaveText('30.00');

    // The settlement folded the whole bill into an invoice, so the door closed with
    // the sentence that says where the remainder lives — the milestone's boundary,
    // told to the front desk instead of answered as a 422.
    await expect(page.getByText(/The remaining 30\.00 is held on this visit/)).toBeVisible();
    await expect(page.getByTestId('record-payment')).toHaveCount(0);

    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/payments`),
    );
    expect(post).toBeTruthy();
    // Minor units on the wire, and a blank reference dropped rather than sent.
    expect(post?.body).toEqual({ method: 'CASH', amountMinor: 5500 });

    // Two reads of each register, not one: the section's own, and the invalidation's.
    await expect.poll(() => paymentsReads(api.recorded)).toBe(2);
    await expect.poll(() => chargesReads(api.recorded)).toBe(2);

    // Recording a payment changes nothing about the visit itself — the invalidations
    // were the registers', not `['visits']` wholesale.
    await expect.poll(() => visitReads(api.requests)).toBe(1);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('keeps the draft when a payment is refused', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/charges`]: {
          body: visitCharges([visitCharge]),
        },
        [`/api/v1/visits/${VISIT_ID}/payments`]: {
          body: visitPayments([]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/payments`]: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'The payment reference is too long',
              requestId: 'e2e',
            },
          },
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-payments').click();
    await expect(page.getByText('No payments recorded yet.')).toBeVisible();

    await page.getByTestId('payment-amount').fill('55.00');
    await page.getByTestId('payment-method').click();
    await page.getByRole('option', { name: /Cash/ }).click();
    await page.getByTestId('payment-reference').fill('Too much text');
    await page.getByTestId('record-payment').click();

    // The refusal reaches the screen in the API's own words, and the amount the
    // front desk typed is still in the box — a failed request that cleared it would
    // be the most destructive thing this panel does.
    await expect(page.getByRole('alert')).toHaveText(/The payment reference is too long/);
    await expect(page.getByTestId('payment-amount')).toHaveValue('55.00');
    await expect(page.getByTestId('payment')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('lists the files on the visit, in the clinic’s clock, only once the section is open', async ({
    page,
  }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/attachments`]: {
          body: visitAttachments([visitAttachment]),
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);

    // The summary is what the workspace opens on, and the files were not asked for
    // until somebody asked to see them.
    await expect(page.getByTestId('visit-workspace')).toBeVisible();
    expect(attachmentsReads(api.recorded)).toBe(0);

    await page.getByTestId('visit-section-attachments').click();

    // 13:00Z is 08:00 in Lima: a file's time is the clinic's clock again, on a row
    // nothing but the endpoint could have produced.
    await expect(page.getByTestId('attachment').first()).toContainText(visitAttachment.fileName);
    await expect(page.getByTestId('attachment').first()).toContainText('image/png');
    await expect(page.getByTestId('attachment').first()).toContainText('512400 bytes');
    await expect(page.getByTestId('attachment').first()).toContainText('08:00');
    await expect(page.getByTestId('attachment').first()).not.toContainText('13:00');

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('attaches a file and shows it only once the server has stored it', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    const api = await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/attachments`]: {
          body: visitAttachments([visitAttachment]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/attachments`]: { body: attachedFile, status: 201 },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-attachments').click();

    await expect(page.getByTestId('attachment').first()).toContainText(visitAttachment.fileName);

    await page.getByTestId('attachment-name').fill(`  ${attachedFile.fileName}  `);
    await page.getByTestId('attachment-content-type').fill(attachedFile.contentType ?? '');
    await page.getByTestId('attachment-size').fill(String(attachedFile.sizeBytes ?? ''));
    await page.getByTestId('attach-file').click();

    // The server's answer to the POST is installed before the POST can resolve, so
    // the refetch the mutation triggers reads the file list as it now stands. The
    // row that appears carries the server's own `id` — which is the point: nothing
    // in the browser could have produced it, so nothing but the refetch could have
    // put it on screen.
    await installApi(page, {
      [`/api/v1/visits/${VISIT_ID}/attachments`]: {
        body: visitAttachments([visitAttachment, attachedFile]),
      },
    });

    const filed = page.getByTestId('attachment').filter({ hasText: 'referral-orthodontics.pdf' });
    await expect(filed).toBeVisible();
    await expect(filed).toContainText('08:35');
    await expect(page.getByTestId('attachment-name')).toHaveValue('');
    await expect(page.getByTestId('attachment-content-type')).toHaveValue('');

    const post = api.recorded.find(
      (entry) => entry.method === 'POST' && entry.url.includes(`/visits/${VISIT_ID}/attachments`),
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, so the server is not asked to store what the box's
    // edges happen to hold; and the visit's id is in the URL, not on the wire.
    expect(post?.body).toEqual({
      fileName: attachedFile.fileName,
      contentType: attachedFile.contentType,
      sizeBytes: attachedFile.sizeBytes,
    });

    // Two reads, not one: the section's own, and the one the invalidation asked for.
    await expect.poll(() => attachmentsReads(api.recorded)).toBe(2);

    // Attaching a file changes nothing about the visit itself — the invalidation was
    // the section's, not `['visits']` wholesale.
    await expect.poll(() => visitReads(api.requests)).toBe(1);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });

  test('keeps the draft when a file is refused', async ({ page }) => {
    const errors = watchForConsoleErrors(page);
    await installApi(page, {
      ...visitWorkspaceFixtures({
        [`/api/v1/visits/${VISIT_ID}/attachments`]: {
          body: visitAttachments([]),
        },
        [`POST /api/v1/visits/${VISIT_ID}/attachments`]: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'A file needs a name',
              requestId: 'e2e',
            },
          },
        },
      }),
    });

    await page.goto(`/visits/${VISIT_ID}`);
    await page.getByTestId('visit-section-attachments').click();
    await expect(page.getByText('No files attached yet.')).toBeVisible();

    await page.getByTestId('attachment-name').fill('Half a name');
    await page.getByTestId('attach-file').click();

    // The refusal reaches the screen in the API's own words, and the name the front
    // desk typed is still in the box — a failed request that took it away would be
    // the most destructive thing this panel does.
    await expect(page.getByRole('alert')).toHaveText(/A file needs a name/);
    await expect(page.getByTestId('attachment-name')).toHaveValue('Half a name');
    await expect(page.getByTestId('attachment')).toHaveCount(0);

    expect(expectedResourceFailures(errors)).toEqual([]);
  });
});
