/**
 * Tests for the shared entry point.
 *
 * `mountApp` is the one call both shells make, so a bug here is invisible to
 * every feature test while leaving the real application blank. These cover the
 * mount contract and the build-time configuration read.
 */

import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountApp, readApiBaseUrl } from './mount.js';
import { createAppRouter } from './router.js';

afterEach(() => {
  // vi.stubEnv, not a direct assignment: Vitest's import.meta.env is a proxy that
  // only it can restore, and assigning to it is a parse error under Vite 8.
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

function mountInto(container: HTMLElement): ReturnType<typeof createAppRouter> {
  const router = createAppRouter({ target: 'web' });
  mountApp({ container, router, apiBaseUrl: 'http://api.test', queryClient: new QueryClient() });
  return router;
}

describe('mountApp', () => {
  it('renders the shared frame into a supplied container', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const router = mountInto(container);
    await router.load();

    // Both halves matter: the route content proves the tree mounted, the frame
    // proves the root route provided it. Neither comes from the shell.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /foundation is mounted/i })).toBeTruthy();
    });
    expect(screen.getByText(/^Denti-Code U3 · Milestone 2/)).toBeTruthy();
  });

  it('defaults to the #root element when no container is given', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    const router = mountInto(root);
    await router.load();

    await waitFor(() => {
      expect(root.textContent).not.toBe('');
    });
  });

  it('reports a missing mount point instead of rendering nothing', () => {
    document.body.innerHTML = '';

    const router = createAppRouter({ target: 'web' });

    expect(() =>
      mountApp({ router, apiBaseUrl: 'http://api.test', queryClient: new QueryClient() }),
    ).toThrow(/No mount point/);
  });

  it('renders the frame once, not a shell layout alongside the shared one', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const router = mountInto(container);
    await router.load();

    // Exactly one header and one footer means one frame. A shell that also
    // rendered its own layout would double these, which is the failure ADR-0008
    // describes.
    await waitFor(() => {
      expect(container.querySelectorAll('header')).toHaveLength(1);
    });
    expect(container.querySelectorAll('footer')).toHaveLength(1);
  });
});

describe('readApiBaseUrl', () => {
  it('prefers the target-specific variable', () => {
    vi.stubEnv('VITE_API_URL', 'http://web.test');
    vi.stubEnv('VITE_API_URL_DESKTOP', 'http://desktop.test');

    expect(readApiBaseUrl('desktop')).toBe('http://desktop.test');
    expect(readApiBaseUrl('web')).toBe('http://web.test');
  });

  it('falls back to the web variable when the desktop one is unset', () => {
    vi.stubEnv('VITE_API_URL', 'http://web.test');
    vi.stubEnv('VITE_API_URL_DESKTOP', undefined);

    // A desktop build is often shipped without its own override. Failing at
    // startup would be worse than pointing it at the same API as the web build.
    expect(readApiBaseUrl('desktop')).toBe('http://web.test');
  });

  it('throws a configuration error when no URL is defined at all', () => {
    vi.stubEnv('VITE_API_URL', undefined);
    vi.stubEnv('VITE_API_URL_DESKTOP', undefined);

    expect(() => readApiBaseUrl('web')).toThrow(/is not defined/);
  });
});
