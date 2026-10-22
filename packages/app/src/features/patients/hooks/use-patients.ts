/**
 * Patient query hooks.
 *
 * A thin layer over the API client: it knows the endpoints and nothing else.
 * Search and paging state stay in the URL (see the route), so a filtered list is
 * linkable and the back button behaves.
 *
 * The response shapes are imported from the domain rather than re-declared here.
 * They used to be hand-copied, which is how `usePatientOdontogram` came to expect
 * `items` while the API has always returned `entries` — nothing caught it because
 * no screen calls that hook yet. One declaration, written where the shape is
 * defined, cannot drift.
 */

import { useQuery } from '@tanstack/react-query';

import type {
  InvoiceSummary,
  PatientBalance,
  PatientListEntry,
  PatientOdontogram,
  PatientProfile,
  PatientStatement,
  TreatmentPlanSummary,
} from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface PatientListResponse {
  readonly items: readonly PatientListEntry[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export function usePatientList(options: {
  readonly search: string;
  readonly page: number;
  readonly limit: number;
  /** Set false to hold the query back until the caller actually has input. */
  readonly enabled?: boolean;
}) {
  const client = useApiClient();
  const { search, page, limit, enabled = true } = options;

  return useQuery({
    queryKey: ['patients', 'list', { search, page, limit }],
    queryFn: () =>
      client.get<PatientListResponse>('/patients', {
        // Empty is sent as absent, not as `q=`, so the URL and the cache key stay
        // identical for "no search" and "search cleared".
        query: { q: search.length > 0 ? search : undefined, page, limit },
      }),
    // Keeps a previous page on screen while the next one loads, instead of
    // flashing an empty list on every keystroke.
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function usePatient(patientId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'profile', patientId],
    queryFn: () => client.get<PatientProfile>(`/patients/${patientId}`),
    enabled: patientId.length > 0,
  });
}

export function usePatientOdontogram(patientId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'odontogram', patientId],
    queryFn: () => client.get<PatientOdontogram>(`/patients/${patientId}/odontogram`),
    enabled: patientId.length > 0,
  });
}

export interface PatientTreatmentPlansResponse {
  readonly items: readonly TreatmentPlanSummary[];
}

/**
 * Everything this patient has been offered, newest first.
 *
 * Scoped through the patient, so a patient this clinic does not hold answers 404
 * rather than `[]` — "not here" and "nothing planned" are different sentences and
 * the section would say the wrong one. The `progress` on each plan is the
 * server's projection of the rows, not a count this screen does for itself.
 */
export function usePatientTreatmentPlans(patientId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'treatment-plans', patientId],
    queryFn: () =>
      client.get<PatientTreatmentPlansResponse>(`/patients/${patientId}/treatment-plans`),
    enabled: patientId.length > 0,
  });
}

export interface PatientInvoicesResponse {
  readonly items: readonly InvoiceSummary[];
}

/**
 * Every document this patient has been issued, newest first.
 *
 * Scoped through the patient, so a patient this clinic does not hold answers 404
 * rather than `[]` — "not here" and "nothing billed" are different sentences. Each
 * row's totals are the server's stored numbers and its `balanceMinor` the server's
 * arithmetic, so the section never recomputes what a printed document says.
 */
export function usePatientInvoices(patientId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'invoices', patientId],
    queryFn: () => client.get<PatientInvoicesResponse>(`/patients/${patientId}/invoices`),
    enabled: patientId.length > 0,
  });
}

/**
 * What the patient owes this clinic, as the ledger's one summary line.
 *
 * A separate read from the document list, because the five figures are added up by
 * the domain across every document and every payment — a section that totalled the
 * list it had just fetched would be a second, quieter answer to the same question,
 * and the two would drift the moment a payment landed on a page the section was not
 * showing.
 *
 * A patient this clinic does not hold answers 404 rather than zeros, for the same
 * reason the list does.
 */
export function usePatientBalance(patientId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'balance', patientId],
    queryFn: () => client.get<PatientBalance>(`/patients/${patientId}/balance`),
    enabled: patientId.length > 0,
  });
}

/**
 * The patient's ledger as a history: every issued document and payment, oldest
 * first, with the balance after each line.
 *
 * `enabled` is the section's own switch. A statement is a report the desk asks for
 * rather than a card that is always on screen, so the profile does not fetch it
 * until the person opens it — and a profile whose statement read failed does not
 * paint a red box nobody asked to see.
 *
 * The figures are the server's, including the running balance and the closing
 * figure. A patient this clinic does not hold answers 404 rather than an empty
 * history, for the same reason the balance does.
 */
export function usePatientStatement(patientId: string, enabled = true) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['patients', 'statement', patientId],
    queryFn: () => client.get<PatientStatement>(`/patients/${patientId}/statement`),
    enabled: enabled && patientId.length > 0,
  });
}
