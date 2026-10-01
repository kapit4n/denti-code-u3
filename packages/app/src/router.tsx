/**
 * Router construction.
 *
 * Both shells call `createAppRouter` and never build a router themselves: the
 * route tree, the history type and the root context all live here, so web and
 * desktop cannot drift apart in how they navigate.
 *
 * History is the one genuine difference between the targets, and it is decided
 * here rather than in either shell. A Tauri window is served from a custom
 * protocol where there is no real path to push, so the desktop build uses memory
 * history. That is a platform fact, so it belongs next to the platform contract,
 * not duplicated in `apps/desktop`.
 */

import {
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';

import { capabilitiesForTarget, type RuntimeTarget } from './platform/index.js';
import type { RootRouteContext } from './routes/__root.js';
import { routeTree } from './routeTree.gen.js';

export interface CreateAppRouterOptions {
  /** Supplied by the deployment shell. Defaults to the web target. */
  readonly target?: RuntimeTarget;
  readonly context?: RootRouteContext;
  /**
   * Injected by tests. Passing a history makes a router testable without a
   * browser URL bar; leaving it out lets the target decide.
   */
  readonly history?: RouterHistory;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

export function createAppRouter({ target = 'web', context, history }: CreateAppRouterOptions = {}) {
  // Annotated rather than inlined so `createRouter` infers the context type from
  // `RootRouteContext`. Inferred from the default instead, it widened to `{}` and
  // `router.options.context.capabilities` stopped typechecking in tests.
  const resolvedContext: RootRouteContext = context ?? {
    // Defaulted rather than left undefined: a router built without explicit
    // capabilities must still report the right runtime, otherwise the desktop
    // shell renders "Web" because it declared a target but passed no context.
    capabilities: capabilitiesForTarget(target),
  };

  return createRouter({
    routeTree,
    context: resolvedContext,
    history: history ?? historyForTarget(target),
    // Preload on intent so hovering a link fetches the next route's data before
    // the click, without eagerly downloading every route at startup.
    defaultPreload: 'intent',
  });
}

function historyForTarget(target: RuntimeTarget): RouterHistory {
  // A Tauri window has no address bar and no server to resolve a deep link on
  // load, so browser history would leave the app unable to restore a URL.
  if (target === 'desktop' || typeof window === 'undefined') {
    return createMemoryHistory({ initialEntries: ['/'] });
  }

  return createBrowserHistory();
}
