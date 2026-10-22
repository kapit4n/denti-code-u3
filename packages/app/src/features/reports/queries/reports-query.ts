/**
 * The report summary query.
 *
 * The key carries the whole period and dentist filter, so changing a date cannot
 * show the previous period's figures while the next request is in flight. The API
 * computes every number; the page formats them and invents none.
 */

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface ReportAppointmentTotals {
  readonly total: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly noShow: number;
  readonly pending: number;
  readonly inTreatment: number;
  readonly bookedMinutes: number;
}

export interface ReportDentistPerformance {
  readonly dentistId: string | null;
  readonly dentistName: string;
  readonly appointments: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly noShow: number;
  readonly pending: number;
  readonly inTreatment: number;
  readonly bookedMinutes: number;
  readonly productionMinor: number;
  /** `null` when the clinic has no recorded hours for this period. */
  readonly capacityMinutes: number | null;
  /** `null` when capacity is unknown; render "—", never "0%". */
  readonly occupancyRate: number | null;
}

export interface ReportSummary {
  readonly period: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
    readonly dentistId: string | null;
  };
  readonly currencyCode: string | null;
  readonly appointments: ReportAppointmentTotals;
  readonly production: { readonly totalMinor: number };
  readonly collections: { readonly totalMinor: number };
  readonly outstanding: { readonly totalMinor: number };
  readonly occupancy: {
    readonly bookedMinutes: number;
    readonly capacityMinutes: number | null;
    readonly rate: number | null;
  };
  readonly dentists: readonly ReportDentistPerformance[];
  readonly generatedAt: string;
}

export interface ReportFilters {
  readonly from: string;
  readonly to: string;
  readonly dentistId?: string | null;
}

export function useReportSummary({ from, to, dentistId }: ReportFilters) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['reports', 'summary', { from, to, dentistId: dentistId ?? null }],
    queryFn: () =>
      client.get<ReportSummary>('/reports/summary', {
        query: {
          from,
          to,
          ...(dentistId ? { dentistId } : {}),
        },
      }),
    // A period with no valid dates would ask the API a question it must refuse.
    enabled: Boolean(from) && Boolean(to) && from <= to,
    // Reports read settled history, but the current month changes as payments are
    // taken and appointments complete. A short stale window keeps a filter tweak
    // instant without showing yesterday's figures all afternoon.
    staleTime: 30_000,
  });
}
