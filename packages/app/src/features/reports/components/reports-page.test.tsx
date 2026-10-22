/**
 * The reports page.
 *
 * The API's arithmetic is tested there. These tests pin what the page must not get
 * wrong on the way to the screen: the clinic-local defaults, the filter reaching the
 * wire, unassigned work staying visible, unknown occupancy reading as unknown, and
 * the export carrying the figures the API returned.
 */
import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlatformProvider } from '../../../providers.js';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import type { PlatformCapabilities } from '../../../platform/index.js';
import { ReportsPage } from './reports-page.js';

const BASE_URL = 'http://api.test/api/v1';

const CLINIC = {
  id: 'clinic-1',
  name: 'Clinica Visible',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [],
  settings: {},
};

const DENTISTS = {
  items: [
    { id: 'd1', fullName: 'Dr. Book', isActive: true },
    { id: 'd2', fullName: 'Dr. Past', isActive: false },
  ],
};

const REPORT = {
  period: {
    from: '2026-10-01',
    to: '2026-10-31',
    timeZone: 'America/Lima',
    dentistId: null,
  },
  currencyCode: 'PEN',
  appointments: {
    total: 12,
    completed: 7,
    cancelled: 1,
    noShow: 1,
    pending: 2,
    inTreatment: 1,
    bookedMinutes: 360,
  },
  production: { totalMinor: 450_000 },
  collections: { totalMinor: 230_000 },
  outstanding: { totalMinor: 220_000 },
  occupancy: { bookedMinutes: 360, capacityMinutes: null, rate: null },
  dentists: [
    {
      dentistId: 'd1',
      dentistName: 'Dr. Book',
      appointments: 10,
      completed: 6,
      cancelled: 1,
      noShow: 1,
      pending: 1,
      inTreatment: 1,
      bookedMinutes: 300,
      productionMinor: 400_000,
      capacityMinutes: null,
      occupancyRate: null,
    },
    {
      dentistId: null,
      dentistName: 'Unassigned',
      appointments: 2,
      completed: 1,
      cancelled: 0,
      noShow: 0,
      pending: 1,
      inTreatment: 0,
      bookedMinutes: 60,
      productionMinor: 50_000,
      capacityMinutes: null,
      occupancyRate: null,
    },
  ],
  generatedAt: '2026-10-31T12:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderReports() {
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));

    if (url.pathname === '/api/v1/clinic') {
      return jsonResponse(CLINIC);
    }
    if (url.pathname === '/api/v1/dentists') {
      return jsonResponse(DENTISTS);
    }
    if (url.pathname === '/api/v1/reports/summary') {
      return jsonResponse(REPORT);
    }

    return jsonResponse(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: `Unexpected ${init?.method ?? 'GET'} ${url.pathname}`,
          requestId: 't',
        },
      },
      501,
    );
  });

  const saveFile = vi.fn(async (name: string, contents: string) => {
    void contents;
    return name;
  });
  const capabilities: PlatformCapabilities = {
    target: 'web',
    hasNativeShell: false,
    locale: 'es-PE',
    timeZone: 'America/Lima',
    async openExternal() {},
    saveFile,
  };

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <PlatformProvider capabilities={capabilities}>
          <ReportsPage />
        </PlatformProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, saveFile };
}

function reportRequests(
  fetchImplementation: ReturnType<typeof renderReports>['fetchImplementation'],
) {
  return fetchImplementation.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/api/v1/reports/summary');
}

describe('ReportsPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws the period figures and keeps unassigned work visible', async () => {
    renderReports();

    expect(await screen.findByTestId('stat-card-value-Appointments')).toHaveTextContent('12');
    expect(screen.getByTestId('stat-card-value-Production')).toHaveTextContent('4500.00 PEN');
    expect(screen.getByTestId('stat-card-value-Collections')).toHaveTextContent('2300.00 PEN');
    expect(screen.getByTestId('stat-card-value-Outstanding')).toHaveTextContent('2200.00 PEN');

    // No recorded hours is unknown, not an empty clinic.
    expect(screen.getByTestId('stat-card-value-Occupancy')).toHaveTextContent('—');

    const rows = await screen.findAllByTestId('report-dentist-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Dr. Book');
    expect(rows[1]).toHaveTextContent('Unassigned');
    expect(rows[1]).toHaveTextContent('500.00 PEN');
  });

  it('defaults in the clinic calendar and sends both dates and the clinician', async () => {
    const { fetchImplementation } = renderReports();

    await screen.findByTestId('stat-card-value-Appointments');
    const initial = reportRequests(fetchImplementation).at(-1);
    expect(initial?.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(initial?.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fireEvent.change(screen.getByTestId('report-from'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByTestId('report-to'), { target: { value: '2026-09-30' } });
    await userEvent.selectOptions(screen.getByTestId('report-dentist'), 'd1');

    await waitFor(() => {
      const latest = reportRequests(fetchImplementation).at(-1);
      expect(latest?.searchParams.get('from')).toBe('2026-09-01');
      expect(latest?.searchParams.get('to')).toBe('2026-09-30');
      expect(latest?.searchParams.get('dentistId')).toBe('d1');
    });
  });

  it('exports the figures the API answered with, under a period name', async () => {
    const { saveFile } = renderReports();

    await screen.findByTestId('stat-card-value-Appointments');
    await userEvent.click(screen.getByTestId('report-export'));

    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const [name, contents] = saveFile.mock.calls[0]!;
    expect(name).toBe('denti-code-report-2026-10-01_2026-10-31.csv');
    expect(contents).toContain('Production,4500.00 PEN');
    expect(contents).toContain('Unassigned');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('refuses an inverted period before asking the API', () => {
    renderReports();

    fireEvent.change(screen.getByTestId('report-from'), { target: { value: '2026-10-31' } });
    fireEvent.change(screen.getByTestId('report-to'), { target: { value: '2026-10-01' } });

    expect(screen.getByTestId('report-range-error')).toHaveTextContent(
      'start date must be on or before the end date',
    );
    expect(screen.getByTestId('report-export')).toBeDisabled();
  });
});
