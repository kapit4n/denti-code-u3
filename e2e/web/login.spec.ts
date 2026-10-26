/**
 * Signing in and out, in a real browser.
 *
 * The suite seeds a session for every other spec (see `fixtures/frozen-clock.ts`),
 * so these tests remove it first — the point here is the edge the rest of the
 * suite skips over: the app must show a login screen when there is no session, and
 * must reach the shell only after the API agrees.
 */

import { expect, test } from './fixtures/frozen-clock.js';
import { installApi } from './fixtures/mock-api.js';

const LOGIN_BODY = {
  token: 'fresh-e2e-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    clinicId: '00000000-0000-4000-8000-000000000002',
    email: 'admin@denti-code.test',
    fullName: 'E2E Admin',
    role: 'ADMINISTRATOR',
    isActive: true,
  },
};

test.describe('Authentication', () => {
  async function startLoggedOut(page: import('@playwright/test').Page): Promise<void> {
    // Added after the suite's seeding script, so it runs second and undoes it.
    await page.addInitScript(() => window.localStorage.removeItem('denti-code-session'));
  }

  test('shows the login screen when there is no session', async ({ page }) => {
    await startLoggedOut(page);
    await page.goto('/');

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    // The shell is not rendered without a session.
    await expect(page.getByRole('heading', { name: 'Foundation is mounted' })).toHaveCount(0);
  });

  test('reaches the shell after a successful login', async ({ page }) => {
    await startLoggedOut(page);
    await installApi(page, {
      'POST /api/v1/auth/login': { body: LOGIN_BODY },
      '/api/v1/auth/logout': { status: 204, body: null },
    });

    await page.goto('/');
    await page.getByLabel('Email').fill('admin@denti-code.test');
    await page.getByLabel('Password').fill('denti-code-dev');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Foundation is mounted' })).toBeVisible();
  });

  test('shows one message when the API refuses the credentials', async ({ page }) => {
    await startLoggedOut(page);
    await installApi(page, {
      'POST /api/v1/auth/login': {
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'The email or password is incorrect' } },
      },
    });

    await page.goto('/');
    await page.getByLabel('Email').fill('admin@denti-code.test');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.');
  });

  test('says it is throttled instead of blaming the password', async ({ page }) => {
    await startLoggedOut(page);
    await installApi(page, {
      'POST /api/v1/auth/login': {
        status: 429,
        body: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many sign-in attempts. Try again later.',
            requestId: 'req-e2e-throttled',
          },
        },
      },
    });

    await page.goto('/');
    await page.getByLabel('Email').fill('admin@denti-code.test');
    await page.getByLabel('Password').fill('denti-code-dev');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Too many sign-in attempts. Try again later.');
  });

  test('signs out and returns to the login screen', async ({ page }) => {
    await installApi(page, {
      '/api/v1/auth/logout': { status: 204, body: null },
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Foundation is mounted' })).toBeVisible();

    await page.getByRole('button', { name: /sign out/i }).click();

    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
