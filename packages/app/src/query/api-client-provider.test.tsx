/**
 * Tests for the provider that shares the API client with features.
 *
 * These guard the seam between the shared app and the two deployment shells. A
 * mistake here is invisible to feature tests: features pass against a correctly
 * wired provider while the real app renders blank.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import { ApiClientProvider, useApiClient } from './api-client-provider.js';

/**
 * Reports the identity of the client it receives.
 *
 * Identity is the property under test, so the probe records references rather
 * than comparing URLs: `ApiClient` keeps `baseUrl` private, and a test-only
 * accessor on production code would be a worse trade than a reference check.
 */
function IdentityProbe({
  onIdentity,
}: {
  readonly onIdentity: (client: ApiClient) => void;
}): ReactNode {
  onIdentity(useApiClient());
  return <span data-testid="probe">probe</span>;
}

describe('ApiClientProvider', () => {
  it('serves an injected client instead of building one', () => {
    const injected = new ApiClient({
      baseUrl: 'http://injected.test',
      fetchImplementation: vi.fn(),
    });
    let received: ApiClient | undefined;

    render(
      <ApiClientProvider baseUrl="http://ignored.test" client={injected}>
        <IdentityProbe onIdentity={(value) => (received = value)} />
      </ApiClientProvider>,
    );

    // The injected client wins, so a test's stub is never shadowed by a real one.
    expect(received).toBe(injected);
  });

  it('builds a client when none is injected', () => {
    let received: ApiClient | undefined;

    render(
      <ApiClientProvider baseUrl="http://api.test">
        <IdentityProbe onIdentity={(value) => (received = value)} />
      </ApiClientProvider>,
    );

    expect(received).toBeInstanceOf(ApiClient);
  });

  it('keeps the same client identity when the provider re-renders', () => {
    const seen: ApiClient[] = [];

    // A fresh element each time. Reusing one element object would let React bail
    // out of the re-render, and the test would prove nothing.
    const tree = () => (
      <ApiClientProvider baseUrl="http://api.test">
        <IdentityProbe onIdentity={(client) => seen.push(client)} />
      </ApiClientProvider>
    );

    const { rerender } = render(tree());
    rerender(tree());
    rerender(tree());

    // The probe rendered three times. All three must see the same object: a fresh
    // client per render would invalidate every consumer on every parent render.
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(1);
  });

  it('builds a new client only when the base URL changes', () => {
    const seen: ApiClient[] = [];

    const { rerender } = render(
      <ApiClientProvider baseUrl="http://first.test">
        <IdentityProbe onIdentity={(client) => seen.push(client)} />
      </ApiClientProvider>,
    );

    rerender(
      <ApiClientProvider baseUrl="http://second.test">
        <IdentityProbe onIdentity={(client) => seen.push(client)} />
      </ApiClientProvider>,
    );

    // A desktop build switching backends must reach features without a reload,
    // which only works if the change is not swallowed by an over-eager memo.
    expect(new Set(seen).size).toBe(2);
  });

  it('throws a wiring error when called without a provider', () => {
    // React logs the thrown error; silence it so the suite output stays readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<IdentityProbe onIdentity={() => undefined} />)).toThrow(
      /outside an ApiClientProvider/,
    );

    consoleError.mockRestore();
  });

  it('nests below a query client so both are available to features', () => {
    let received: ApiClient | undefined;

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider baseUrl="http://api.test">
          <IdentityProbe onIdentity={(value) => (received = value)} />
        </ApiClientProvider>
      </QueryClientProvider>,
    );

    expect(received).toBeInstanceOf(ApiClient);
  });
});
