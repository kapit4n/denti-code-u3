/**
 * The API client, as React context.
 *
 * Features read the client from context instead of importing a module-level
 * singleton. Two reasons, both practical:
 *
 *   * A test can supply a client whose `fetch` is a stub, with no module mocking
 *     and no shared state leaking between tests.
 *   * The desktop shell and the web shell can point at different API instances
 *     (a bundled server, a remote deployment) without a rebuild of the client.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  readonly baseUrl: string;
  /** Injected by tests. Otherwise built from `baseUrl`. */
  readonly client?: ApiClient;
  readonly children: ReactNode;
}

export function ApiClientProvider({
  baseUrl,
  client,
  children,
}: ApiClientProviderProps): ReactNode {
  // Memoised because an unmemoised client would get a new identity on every
  // render, invalidating every context consumer on every parent render.
  const value = useMemo(() => client ?? new ApiClient({ baseUrl }), [client, baseUrl]);

  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

/**
 * The shared API client.
 *
 * Throws rather than returning null when no provider is mounted: a feature that
 * calls this outside the tree is a wiring bug, and failing at the call site with
 * a clear message beats every request failing later with a network error.
 */
export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);

  if (!client) {
    throw new Error(
      'useApiClient was called outside an ApiClientProvider. Features get the client from context, never by importing it.',
    );
  }

  return client;
}
