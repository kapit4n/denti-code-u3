/**
 * The reports page.
 *
 * Thin by design: the sidebar has pointed Reports here since the shell was built,
 * and the feature owns the filters, table and export. Keeping the route a one-line
 * mount is what lets the page be tested with a stub API and no router.
 */

import { createFileRoute } from '@tanstack/react-router';

import { ReportsPage } from '../features/reports/components/reports-page.js';

export const Route = createFileRoute('/reports')({
  component: ReportsPage,
});
