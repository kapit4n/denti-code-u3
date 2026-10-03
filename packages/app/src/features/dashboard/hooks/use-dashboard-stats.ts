/**
 * Dashboard query hooks.
 *
 * The hooks are thin on purpose: they know the endpoint and the response shape,
 * and nothing else. All figures are computed by the API (see
 * `apps/api/src/http/routes/dashboard.ts`); nothing is derived, summed or
 * hard-coded here, because a second place that computes a metric is a second
 * place that can disagree with the first.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../query/api-client-provider.js';

/** One appointment as the API returns it. */
export interface DashboardAppointment {
  readonly id: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly status: string;
  readonly dentistId: string | null;
  readonly firstName: string;
  readonly lastName: string;
}

/** Today's counts, split so the UI never re-derives them. */
export interface DashboardTodayCounts {
  readonly appointments: number;
  readonly completed: number;
  readonly pending: number;
  readonly inTreatment: number;
  readonly cancelled: number;
  readonly noShow: number;
}

export interface DashboardClinicCounts {
  readonly activePatients: number;
  readonly pendingTreatmentItems: number;
  /**
   * Integer minor units (cents). Never divide this in the UI — use
   * `formatMinorUnits` so the arithmetic stays in integers.
   */
  readonly collectedThisMonthMinor: number;
  /** ISO currency the minor units above belong to; `null` when unknown. */
  readonly currencyCode: string | null;
  /** `null` when today's capacity is unknown; render "—", not "0%". */
  readonly occupancyRate: number | null;
}

export interface DashboardStats {
  readonly today: DashboardTodayCounts;
  readonly clinic: DashboardClinicCounts;
}

export interface DashboardPatientSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly recordNumber: string | null;
  readonly createdAt: string;
}

export interface CalendarPreviewDay {
  readonly day: string;
  readonly total: number;
  readonly completed: number;
}

export interface CalendarPreview {
  readonly from: string;
  readonly to: string;
  readonly days: number;
  readonly items: readonly CalendarPreviewDay[];
}

interface ListResponse<T> {
  readonly items: readonly T[];
}

export function useDashboardStats() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => client.get<DashboardStats>('/dashboard/stats'),
  });
}

export function useTodayAppointments() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['dashboard', 'today-appointments'],
    queryFn: () => client.get<ListResponse<DashboardAppointment>>('/dashboard/today-appointments'),
  });
}

export function useUpcomingVisits() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['dashboard', 'upcoming-visits'],
    queryFn: () => client.get<ListResponse<DashboardAppointment>>('/dashboard/upcoming-visits'),
  });
}

export function useRecentPatients() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['dashboard', 'recent-patients'],
    queryFn: () => client.get<ListResponse<DashboardPatientSummary>>('/dashboard/recent-patients'),
  });
}

export function useCalendarPreview(days = 14) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['dashboard', 'calendar-preview', days],
    queryFn: () => client.get<CalendarPreview>('/dashboard/calendar-preview', { query: { days } }),
  });
}
