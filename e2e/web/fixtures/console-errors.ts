/**
 * Console-error capture for the end-to-end specs.
 *
 * A page that logs an error but renders correctly is exactly the kind of failure
 * that survives review, so collecting errors is part of the assertion rather than
 * something a CI reporter surfaces on its own. Kept here because both spec files
 * want it and two copies would drift.
 */

import type { Page } from '@playwright/test';

export function watchForConsoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  // An uncaught exception never reaches `console`, and an error boundary
  // swallowing one is precisely how a crash becomes a plausible-looking page.
  page.on('pageerror', (error) => errors.push(error.message));

  return errors;
}
