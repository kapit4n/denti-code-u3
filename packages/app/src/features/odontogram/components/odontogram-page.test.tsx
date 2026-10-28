/**
 * Tests for the odontogram page.
 *
 * The chart itself is covered with the profile's section; what is new here is the
 * gate in front of it. The page must not ask for a chart before a patient is chosen
 * (there is no patient whose chart that would be), and choosing one must mount the
 * chart that answers for **that** id. A page that fetched on mount, or kept the
 * previous chart after a switch, would render a tooth map that belongs to nobody.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { OdontogramPage } from './odontogram-page.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const CHART_PATH = `/api/v1/patients/${PATIENT_ID}/odontogram`;

const PATIENTS = {
  items: [
    {
      id: PATIENT_ID,
      recordNumber: 'P-000001',
      firstName: 'Ana',
      lastName: 'García',
      preferredName: null,
      birthDate: null,
      isActive: true,
    },
  ],
  pagination: { page: 1, limit: 8, total: 1, totalPages: 1 },
};

const CHART = {
  entries: [
    {
      id: 'entry-1',
      patientId: PATIENT_ID,
      visitId: null,
      dentition: 'PERMANENT',
      tooth: '16',
      surfaces: ['MESIAL'],
      condition: 'CARIES',
      notes: 'Composite patch scheduled.',
      recordedAt: '2026-10-05T13:00:00.000Z',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPage() {
  const reads: string[] = [];

  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    reads.push(url.pathname);
    if (url.pathname === '/api/v1/patients') {
      return jsonResponse(PATIENTS);
    }
    if (url.pathname === CHART_PATH) {
      return jsonResponse(CHART);
    }
    if (url.pathname === '/api/v1/clinic') {
      return jsonResponse({ timeZone: 'America/Lima' });
    }
    return jsonResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'Unexpected request', requestId: 'test' } },
      501,
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <OdontogramPage />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { reads };
}

describe('OdontogramPage', () => {
  it('waits for a patient before asking for a chart', async () => {
    const { reads } = renderPage();

    expect(screen.getByText('Choose a patient to open their odontogram.')).toBeInTheDocument();
    expect(screen.queryByTestId('odontogram-chart')).not.toBeInTheDocument();
    expect(reads.some((path) => path.endsWith('/odontogram'))).toBe(false);
  });

  it('opens the chosen patient’s chart, in the clinic’s clock', async () => {
    const user = userEvent.setup();
    const { reads } = renderPage();

    await user.type(screen.getByRole('combobox'), 'Ana');
    await user.click(await screen.findByRole('option', { name: /Ana García/ }));

    await waitFor(() => expect(reads.filter((path) => path === CHART_PATH)).toHaveLength(1));

    await waitFor(() =>
      expect(screen.getByTestId('odontogram-tooth-16')).toHaveAttribute('data-condition', 'CARIES'),
    );
    expect(screen.getByTestId('odontogram-entry')).toHaveTextContent('Tooth 16');
    // 13:00Z is 08:00 in Lima: the row is drawn on the clinic's clock.
    expect(screen.getByTestId('odontogram-entry')).toHaveTextContent('08:00');
  });
});
