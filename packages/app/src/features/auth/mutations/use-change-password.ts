import { useMutation } from '@tanstack/react-query';
import type { ChangePasswordBody } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useChangePassword() {
  const client = useApiClient();

  return useMutation({
    mutationFn: (input: ChangePasswordBody) =>
      client.post<void, ChangePasswordBody>('/auth/change-password', input),
  });
}
