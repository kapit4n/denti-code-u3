/**
 * Application entry point.
 *
 * Both deployment shells call `mountApp` and nothing else. That single call is
 * what makes the shells thin: they supply platform capabilities and the API base
 * URL, and the application owns the router, the query client and the frame.
 *
 * A shell that had to assemble its own router, its own providers and its own
 * layout would be a second copy of this application, which is the exact failure
 * ADR-0008 exists to prevent.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { PlatformCapabilities, RuntimeTarget } from './platform/index.js';
import { ApiClientProvider } from './query/api-client-provider.js';
import type { RootRouteContext } from './routes/__root.js';
import { createAppRouter, type AppRouter } from './router.js';

export interface MountAppOptions {
  /**
   * Where the React tree is attached. Optional so a shell can pass its own
   * `#root` element; defaults to that id.
   */
  readonly container?: HTMLElement;
  readonly target?: RuntimeTarget;
  readonly capabilities?: PlatformCapabilities;
  /** Origin of the REST API, e.g. `http://localhost:3010`. */
  readonly apiBaseUrl?: string;
  /** Injected by tests; otherwise a router is built for `target`. */
  readonly router?: AppRouter;
  readonly queryClient?: QueryClient;
}

export function mountApp(options: MountAppOptions = {}): void {
  const container = resolveContainer(options.container);
  const router =
    options.router ?? createAppRouter({ target: options.target, context: contextFor(options) });

  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={options.queryClient ?? createQueryClient()}>
        <ApiClientProvider baseUrl={options.apiBaseUrl ?? readApiBaseUrl(options.target)}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

/**
 * Root route context built from what the shell supplied.
 *
 * Capabilities are omitted entirely when the shell provides none, rather than
 * passed as `capabilities: undefined`. That distinction matters: `createAppRouter`
 * fills in capabilities from the target only when the context is absent, so an
 * always-present object with an undefined value would suppress the default and
 * leave the desktop app reporting itself as web.
 */
function contextFor(options: MountAppOptions): RootRouteContext | undefined {
  return options.capabilities ? { capabilities: options.capabilities } : undefined;
}

function resolveContainer(container: HTMLElement | undefined): HTMLElement {
  if (container) {
    return container;
  }

  const found = document.getElementById('root');
  if (!found) {
    throw new Error('No mount point. Expected an element with id "root" in index.html.');
  }

  return found;
}

/**
 * Read the API URL from the build-time environment.
 *
 * `import.meta.env` is inlined by Vite, so this is not a runtime lookup that
 * could fail later. A missing value is a configuration error and is reported as
 * one, rather than producing a client that fails its first request with a
 * confusing network error.
 */
export function readApiBaseUrl(target: RuntimeTarget | undefined): string {
  const variable = target === 'desktop' ? 'VITE_API_URL_DESKTOP' : 'VITE_API_URL';
  const value = import.meta.env[variable] ?? import.meta.env.VITE_API_URL;

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${variable} is not defined. Copy .env.example to .env and set it to the API base URL.`,
    );
  }

  return value;
}

/**
 * Default query behaviour.
 *
 * Stale data is refetched on focus because a clinic's schedule changes while the
 * operator is looking at it, and retrying a failed read once is enough — a
 * scheduling conflict will not fix itself, so retrying writes would be harmful.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
