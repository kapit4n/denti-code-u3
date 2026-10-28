/**
 * The odontogram page at `/odontogram`.
 *
 * Thin like every other list-style route: the screen lives in its feature so it can
 * be rendered with a stub `fetch` without the shell around it.
 */

import { createFileRoute } from '@tanstack/react-router';

import { OdontogramPage } from '../features/odontogram/components/odontogram-page.js';

export const Route = createFileRoute('/odontogram')({
  component: OdontogramPage,
});
