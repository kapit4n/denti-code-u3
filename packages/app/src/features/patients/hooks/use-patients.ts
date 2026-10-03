/**
 * Patient query hooks.
 *
 * A thin layer over the API client: it knows the endpoints and the response
 * shapes, and nothing else. Search and paging state stay in the URL (see the
 * route), so a filtered list is linkable and the back button behaves.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../query/api-client-provider.js';

/** A row in the patient list. Deliberately not the whole record. */
export interface PatientSummary {
  readonly id: string;
  readonly recordNumber: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly birthDate: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface PatientPagination {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PatientListResponse {
  readonly items: readonly PatientSummary[];
  readonly pagination: PatientPagination;
}

export interface PatientAppointment {
  readonly id: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly status: string;
  readonly dentistId: string | null;
}

export interface PatientVisit {
  readonly id: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly reason: string | null;
  readonly summary: string | null;
  readonly createdAt: string;
}

export interface PatientTreatmentItem {
  readonly id: string;
  readonly planId: string;
  readonly planStatus: string;
  readonly title: string | null;
  readonly tooth: string | null;
  readonly quantity: number;
  /** Minor units of the clinic currency. Format with `formatMinorUnits`. */
  readonly estimatedPriceMinor: number;
}

export interface PatientBalance {
  readonly outstandingMinor: number;
  readonly chargeCount: number;
  readonly currencyCode: string | null;
}

/** The full profile: the record plus its clinical context. */
export interface PatientProfile extends PatientSummary {
  readonly clinicId: string;
  readonly identificationNumber: string | null;
  readonly address: string | null;
  readonly allergies: string | null;
  readonly additionalData: Record<string, unknown>;
  readonly updatedAt: string;
  readonly upcomingAppointment: PatientAppointment | null;
  readonly recentVisits: readonly PatientVisit[];
  readonly outstandingTreatments: readonly PatientTreatmentItem[];
  readonly financialBalance: PatientBalance;
}

export interface OdontogramEntry {
  readonly id: string;
  readonly dentition: string;
  readonly tooth: string;
  readonly surfaces: readonly string[];
  readonly condition: string;
  readonly notes: string | null;
  readonly recordedAt: string;
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
    queryFn: () =>
      client.get<{ readonly items: readonly OdontogramEntry[] }>(
        `/patients/${patientId}/odontogram`,
      ),
    enabled: patientId.length > 0,
  });
}
