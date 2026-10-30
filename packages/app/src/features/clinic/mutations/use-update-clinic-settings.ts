import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Clinic } from '@denti-code-u3/domain';
import type { UpdateClinicSettingsInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

export function useUpdateClinicSettings() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateClinicSettingsInput) =>
      client.put<Clinic, UpdateClinicSettingsInput>('/clinic', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clinic', 'settings'] });
    },
  });
}
