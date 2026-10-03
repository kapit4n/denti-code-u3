/**
 * Registering a patient.
 *
 * The first mutation in the application, and the shape every later one should
 * follow: the hook knows the endpoint and the response type, and nothing about
 * how the form is laid out.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreatePatientInput } from '@denti-code-u3/validation';

import { useApiClient } from '../../../query/api-client-provider.js';

/** What the API returns after registering, including the assigned number. */
export interface RegisteredPatient {
  readonly id: string;
  readonly clinicId: string;
  /** Assigned by the server. Never sent by the client. */
  readonly recordNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly identificationNumber: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly birthDate: string | null;
  readonly isActive: boolean;
}

export function useRegisterPatient() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePatientInput) =>
      client.post<RegisteredPatient, CreatePatientInput>('/patients', input),
    onSuccess: async (created) => {
      // Prefetch the new profile so landing on it after registration does not
      // show a spinner for data the client already asked for.
      await queryClient.prefetchQuery({
        queryKey: ['patients', 'profile', created.id],
        queryFn: () => client.get(`/patients/${created.id}`),
      });

      // The list is cached per search term and page, so there is no single key to
      // update: invalidating the prefix is what makes a new patient appear in
      // whatever list the receptionist goes back to.
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}
