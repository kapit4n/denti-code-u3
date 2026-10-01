import { test, expect } from '@playwright/test';

test.describe('Smoke (web shell)', () => {
  test('application shell renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Denti-Code U3/);
  });
});
