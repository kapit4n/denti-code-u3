/**
 * The clinic's payment ledger at `/payments`.
 *
 * Thin by design: the sidebar has pointed Pay here since the shell was built, and
 * the feature owns the period filter, totals and table. A one-line mount is what
 * lets the page be tested with a stub API and no router.
 */

import { createFileRoute } from '@tanstack/react-router';

import { PaymentsPage } from '../features/payments/components/payments-page.js';

export const Route = createFileRoute('/payments')({
  component: PaymentsPage,
});
