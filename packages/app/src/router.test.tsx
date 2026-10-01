/**
 * Router tests.
 *
 * The point of these is architectural, not visual: prove that the generated
 * route tree mounts, that the root route provides the frame, and that the
 * platform decides the history type. A regression in route wiring should fail
 * here rather than on a blank screen in a packaged build.
 */

import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '@tanstack/react-router';

import { ApiClientProvider } from './query/api-client-provider.js';
import { createAppRouter } from './router.js';
import { defaultWebCapabilities, type PlatformCapabilities } from './platform/index.js';

const desktopCapabilities: PlatformCapabilities = {
  ...defaultWebCapabilities,
  target: 'desktop',
  hasNativeShell: true,
  locale: 'es-PE',
  timeZone: 'America/Lima',
  async openExternal(url) {
    void url;
  },
  async saveFile() {
    return '/tmp/report.csv';
  },
};

function renderApp(capabilities: PlatformCapabilities = defaultWebCapabilities) {
  const router = createAppRouter({
    target: capabilities.target,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { capabilities },
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl="http://api.test/api/v1">
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return router;
}

describe('createAppRouter', () => {
  it('builds a router from the generated route tree', () => {
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/'] }) });

    expect(router.routeTree.id).toBe('__root__');
  });

  it('defaults to the web target when the shell says nothing', () => {
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/'] }) });

    expect(router.options.context.capabilities.target).toBe('web');
    expect(router.options.context.capabilities.hasNativeShell).toBe(false);
  });

  it('accepts platform capabilities into the root route context', () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { capabilities: desktopCapabilities },
    });

    // The behavioural proof is `reports the injected runtime through the frame`
    // below. This checks the wiring in isolation.
    expect(router.options.context).toEqual({ capabilities: desktopCapabilities });
  });

  it('uses memory history for the desktop target, which has no URL to restore', async () => {
    // TanStack returns a plain object from both history factories, so the class
    // name cannot be asserted. Behaviour is the honest check: browser history
    // writes through to `window.history`, memory history never touches it.
    //
    // Two details make this work. The spy is installed before the web router is
    // built, because `createBrowserHistory` captures `window.history.pushState`
    // at construction. And the assertion is awaited, because TanStack defers the
    // write with `queueMicrotask`.
    const pushSpy = vi.spyOn(window.history, 'pushState');

    try {
      const desktop = createAppRouter({ target: 'desktop' });
      desktop.history.push('/patients');
      await Promise.resolve();
      expect(pushSpy).not.toHaveBeenCalled();

      const web = createAppRouter({ target: 'web' });
      web.history.push('/patients');
      await Promise.resolve();
      expect(pushSpy).toHaveBeenCalled();
    } finally {
      pushSpy.mockRestore();
    }
  });
});

describe('the mounted route tree', () => {
  it('renders the index route inside the application frame', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foundation is mounted' })).toBeInTheDocument();
    });

    // The frame comes from the root route, not from the index route. Checking it
    // after the route settles also proves the frame survived the route's own
    // render rather than only appearing on an empty tree.
    expect(screen.getByText('Denti-Code U3')).toBeInTheDocument();
  });

  it('renders the same routes on the desktop target', async () => {
    renderApp(desktopCapabilities);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foundation is mounted' })).toBeInTheDocument();
    });
  });

  it('reports the injected runtime through the frame, not a hardcoded target', async () => {
    // The router renders the root route, so this is the test that proves a
    // desktop capability actually reaches the frame instead of being dropped on
    // the way through the router context.
    renderApp(desktopCapabilities);

    await waitFor(() => {
      expect(screen.getByText('Desktop · America/Lima')).toBeInTheDocument();
    });

    expect(screen.queryByText(/^Web · /)).not.toBeInTheDocument();
  });

  it('renders the frame exactly once, not per route', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Foundation is mounted' })).toBeInTheDocument();
    });

    expect(screen.getAllByText(/^Denti-Code U3 · Milestone 2/)).toHaveLength(1);
  });
});

describe('capabilities defaulting', () => {
  it('reports the desktop target when no capabilities are supplied', () => {
    const desktop = createAppRouter({ target: 'desktop' });
    const web = createAppRouter({ target: 'web' });

    // The desktop shell passes a target and no context. Reading `undefined`
    // here is what made the desktop app render "Web" in its runtime badge.
    expect(desktop.options.context.capabilities.target).toBe('desktop');
    expect(desktop.options.context.capabilities.hasNativeShell).toBe(true);
    expect(web.options.context.capabilities.target).toBe('web');
    expect(web.options.context.capabilities.hasNativeShell).toBe(false);
  });

  it('keeps explicitly injected capabilities', () => {
    const router = createAppRouter({
      target: 'web',
      context: { capabilities: desktopCapabilities },
    });

    expect(router.options.context.capabilities).toBe(desktopCapabilities);
  });
});
