/**
 * The root route: the outermost route in the tree.
 *
 * Every page renders inside it, which is why the application frame lives here
 * exactly once (ADR-0008). A feature route never repeats the header, the footer
 * or the provider tree — it renders content and nothing else.
 *
 * Note what is NOT here: no navigation, no data fetching, no business logic.
 * Those belong to the features this route will eventually host.
 */

import { createRootRouteWithContext, useRouteContext } from '@tanstack/react-router';

import { AppRoot } from '../app-root.js';
import type { PlatformCapabilities } from '../platform/index.js';
import { ThemeProvider } from '../features/theme/theme-provider.js';
import { ErrorBoundary } from '../components/error-boundary.js';
import { Shell } from '../components/shell/index.js';

/**
 * The root route's context.
 *
 * `capabilities` is a context value rather than a component prop because the
 * router renders this route itself, so a shell cannot hand it a prop. The shell
 * passes capabilities to `mountApp`, which forwards them to
 * `createAppRouter` and from there into the router's context.
 */
export interface RootRouteContext {
  /**
   * Required, not optional.
   *
   * `createAppRouter` always fills this in from the target, so a router whose
   * capabilities are `undefined` is a wiring bug rather than a legitimate state.
   * Typing it as optional made every consumer write a fallback branch for a case
   * that cannot happen — and hid the real bug that the desktop shell was hitting.
   */
  readonly capabilities: PlatformCapabilities;
}

/**
 * `createRootRouteWithContext`, not plain `createRootRoute`.
 *
 * The context type has to be attached to the route itself for the generated route
 * tree to carry it, which is what makes `router.options.context` type as
 * `RootRouteContext`. With the plain constructor the tree inferred `{}` and every
 * read of `context.capabilities` failed to typecheck even though the value was
 * there at runtime.
 */
export const Route = createRootRouteWithContext<RootRouteContext>()({
  notFoundComponent: NotFoundComponent,
  component: RootLayout,
});

/**
 * The application frame.
 *
 * Capabilities are read from the router context rather than imported, because the
 * router renders this route: a shell cannot pass it a prop, and reading them here
 * is what makes the desktop target actually report itself as desktop instead of
 * silently falling back to the web defaults.
 */
function RootLayout(): React.ReactNode {
  const { capabilities } = useRouteContext({ from: '__root__' });

  return (
    <ErrorBoundary>
      <AppRoot capabilities={capabilities}>
        <ThemeProvider defaultTheme="light" storageKey="denti-code-theme">
          <Shell />
        </ThemeProvider>
      </AppRoot>
    </ErrorBoundary>
  );
}

function NotFoundComponent(): React.ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">404</h1>
        <p className="mt-2 text-lg text-muted-foreground">Page not found</p>
      </div>
    </div>
  );
}

declare module '@tanstack/react-router' {
  interface Register {
    router: {
      context: RootRouteContext;
    };
  }
}
