/**
 * The users the development "sign in as" chooser offers.
 *
 * The endpoint exists only outside production (ADR 0030). A production build gets
 * a 404, the query settles into an error, and the login screen renders nothing —
 * which is why this is not gated on a client flag that a build could get wrong.
 * `retry: false` keeps that one expected 404 from becoming four.
 */

import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

interface DevUsersResponse {
  readonly items: readonly AuthenticatedUser[];
}

export function useDevUsers() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['auth', 'dev-users'],
    queryFn: () => client.get<DevUsersResponse>('/auth/dev-users'),
    retry: false,
    staleTime: Infinity,
  });
}
