import { expect, test } from './fixtures/frozen-clock.js';

/**
 * Web shell smoke tests.
 *
 * These exist to catch the failures that unit tests structurally cannot: a route
 * tree that compiles but does not mount in a real browser, a provider missing from
 * the tree, or a shell that stopped importing the shared application. All three
 * would leave `packages/app` fully green.
 */

test.describe('Smoke (web shell)', () => {
  test('application shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Denti-Code U3/);
  });

  test('the router mounts a route inside the shared frame', async ({ page }) => {
    await page.goto('/');

    // The route content proves the generated route tree mounted...
    await expect(page.getByRole('heading', { name: 'Foundation is mounted' })).toBeVisible();

    // ...and the frame proves the root route provided it. Both come from
    // packages/app, not from the shell. `exact` matters: the product name also
    // appears in the footer, so a loose match would be ambiguous.
    await expect(page.getByRole('banner')).toContainText('Denti-Code U3');
    await expect(page.getByText(/^Web · /)).toBeVisible();
  });

  test('the shell stays thin: it adds no markup of its own', async ({ page }) => {
    await page.goto('/');

    // The frame must appear exactly once. A shell that also rendered a layout
    // would produce two, which is the failure mode ADR-0008 prevents.
    await expect(page.getByText(/^Denti-Code U3 · Milestone 2/)).toHaveCount(1);
  });

  test('no console errors during startup', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Foundation is mounted' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('design tokens are present in the built stylesheet', async ({ page }) => {
    await page.goto('/');

    // A real hex value, not just a non-empty string: an unresolved var() would
    // still read as present in some engines.
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-info').trim(),
    );

    expect(brand).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
