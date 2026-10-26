/**
 * The session, as React context.
 *
 * Holds the current `StoredSession` and the two acts that change it: `signIn`
 * (call the API, keep what it returns) and `signOut` (revoke server-side, then
 * forget locally). The token is exposed through `getAuthorizationHeader`, which
 * the `ApiClientProvider` reads on every request — so no feature ever touches the
 * token, and there is one place that knows where it lives.
 *
 * The provider does not fetch anything on mount. A session in storage is trusted
 * until a request says otherwise (a 401 clears it), which avoids a blocking
 * round-trip before the first screen renders.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useApiClient } from '../../query/api-client-provider.js';
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
  type SessionUser,
  type StoredSession,
} from './session-storage.js';

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

export interface SessionContextValue {
  readonly session: StoredSession | undefined;
  readonly user: SessionUser | undefined;
  readonly isAuthenticated: boolean;
  signIn(credentials: SignInCredentials): Promise<void>;
  signOut(): Promise<void>;
  /** The header value for `ApiClient`, or `undefined` when signed out. */
  getAuthorizationHeader(): string | undefined;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  readonly children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps): ReactNode {
  const client = useApiClient();
  const [session, setSession] = useState<StoredSession | undefined>(() => readStoredSession());
  const queryClient = useQueryClient();

  const getAuthorizationHeader = useCallback(
    () => (session ? `Bearer ${session.token}` : undefined),
    [session],
  );

  useEffect(() => {
    // Keep the client in sync without recreating it.
    client.setAuthorizationHeaderGetter?.(getAuthorizationHeader);
    return () => client.setAuthorizationHeaderGetter?.(undefined);
  }, [client, getAuthorizationHeader]);

  const signIn = useCallback(
    async ({ email, password }: SignInCredentials) => {
      // The response is validated by the client against the login schema, so a
      // shape change fails here rather than as an undefined token later.
      const result = await client.post<StoredSession, SignInCredentials>('/auth/login', {
        email,
        password,
      });
      const next: StoredSession = {
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      };
      writeStoredSession(next);
      setSession(next);
    },
    [client],
  );

  const signOut = useCallback(async () => {
    try {
      // Revoking is best-effort: if the network or the API is gone, the local
      // session is still cleared, because "log out" must always log the operator
      // out of this browser.
      if (session) {
        await client.post<void, Record<string, never>>('/auth/logout', {});
      }
    } catch {
      // Deliberately swallowed — see above.
    } finally {
      clearStoredSession();
      setSession(undefined);
      // Drop every cached answer: it belongs to the user who just left, and
      // showing it to the next one — on a shared clinic terminal — is the whole
      // point of logging out.
      queryClient.clear();
    }
  }, [client, session, queryClient]);

  /**
   * A 401 from anywhere means the token is no longer accepted (expired, revoked,
   * or the account deactivated). Clearing the session here is what turns that
   * into a login prompt rather than a screen of failed requests.
   */
  useEffect(() => {
    const onStorage = () => setSession(readStoredSession());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    // A 401 from any request (see the query cache in `mount.tsx`) drops the
    // session. The server is the authority on whether the token is still good, so
    // the client defers to it rather than guessing from `expiresAt` alone.
    const onUnauthorized = () => {
      clearStoredSession();
      setSession(undefined);
      queryClient.clear();
    };
    window.addEventListener('denti-code:unauthorized', onUnauthorized);
    return () => window.removeEventListener('denti-code:unauthorized', onUnauthorized);
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      user: session?.user,
      isAuthenticated: session !== undefined,
      signIn,
      signOut,
      getAuthorizationHeader,
    }),
    [session, signIn, signOut, getAuthorizationHeader],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession was called outside a SessionProvider.');
  }
  return context;
}
