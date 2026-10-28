/**
 * The landing route.
 *
 * `/` is not a page of its own. Opening the app should answer the question the
 * dashboard answers — "what is happening today?" — not show a placeholder, so the
 * index redirects instead of rendering. Web history is replaced rather than
 * pushed, so Back from the dashboard does not bounce through the redirect.
 *
 * The redirect runs before authentication is considered. A signed-out visit ends
 * on `/dashboard` behind the login screen, which means signing in lands on the
 * dashboard rather than on whichever URL the shell happened to start with.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard', replace: true });
  },
});
