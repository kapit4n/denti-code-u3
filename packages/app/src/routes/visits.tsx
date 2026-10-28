/**
 * The visit directory at `/visits`.
 *
 * Thin on purpose, like the other list screen: the page is a feature component, so
 * it can be tested with a stub `fetch` and a router that knows only this route.
 * This is the sibling the workspace route's file name was chosen for — a flat
 * `visits_` route, so the directory and the workspace are pages rather than a
 * folder that nests one inside the other.
 */

import { createFileRoute } from '@tanstack/react-router';

import { VisitList } from '../features/visits/components/visit-list.js';

export const Route = createFileRoute('/visits')({
  component: VisitList,
});
