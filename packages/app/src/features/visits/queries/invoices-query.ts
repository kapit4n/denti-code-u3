/**
 * Invoices visible from the visit workspace.
 *
 * The patient owns the invoice list, so this read reuses the patient's invoices
 * endpoint rather than inventing a second visit-scoped one. It is keyed by
 * patientId so issuing a document on a visit invalidates the same list the
 * patient's profile draws.
 */

import { useQuery } from '@tanstack/react-query';
import type { InvoiceSummary } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface PatientInvoicesResponse {
  readonly items: readonly InvoiceSummary[];
}

export function usePatientInvoicesForVisit(patientId: string | null | undefined) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'invoices', patientId],
    queryFn: () => client.get<PatientInvoicesResponse>(`/patients/${patientId as string}/invoices`),
    enabled: Boolean(patientId),
  });
}
