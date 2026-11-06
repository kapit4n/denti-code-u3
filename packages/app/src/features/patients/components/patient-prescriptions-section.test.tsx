import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/index.js';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientPrescriptionsSection } from './patient-prescriptions-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const PRESCRIPTIONS_PATH = `/api/v1/patients/${PATIENT_ID}/prescriptions`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderSection(
  options: {
    readonly prescriptions?: readonly Record<string, unknown>[];
    readonly failure?: { readonly status: number; readonly body: unknown };
  } = {},
) {
  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));

    if (url.pathname === PRESCRIPTIONS_PATH) {
      if (options.failure) {
        return jsonResponse(options.failure.body, options.failure.status);
      }
      return jsonResponse({ prescriptions: options.prescriptions ?? [] });
    }

    return jsonResponse(
      {
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected request', requestId: 't' },
      },
      501,
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const rootRoute = createRootRoute({});
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients/$patientId',
    component: () => (
      <PatientPrescriptionsSection patientId={PATIENT_ID} clinicTimeZone="America/Lima" />
    ),
  });
  const visitRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits/$visitId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([profileRoute, visitRoute]),
    history: createMemoryHistory({ initialEntries: [`/patients/${PATIENT_ID}`] }),
  });

  render(
    <I18nProvider initialLocale="en">
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider baseUrl={BASE_URL} client={client}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );

  return { fetchImplementation };
}

const PRESCRIPTIONS = [
  {
    id: 'prescription-2',
    visitId: 'visit-2',
    patientId: PATIENT_ID,
    dentistId: null,
    medication: 'Amoxicillin',
    dosage: '500 mg',
    route: 'ORAL',
    frequency: 'Every 8 hours',
    durationDays: 7,
    instructions: 'Finish the course.',
    issuedAt: '2026-10-06T13:00:00.000Z',
  },
  {
    id: 'prescription-1',
    visitId: 'visit-1',
    patientId: PATIENT_ID,
    dentistId: null,
    medication: 'Ibuprofen',
    dosage: '400 mg',
    route: 'ORAL',
    frequency: 'Every 8 hours as needed',
    durationDays: 5,
    instructions: null,
    issuedAt: '2026-10-05T13:00:00.000Z',
  },
];

describe('PatientPrescriptionsSection', () => {
  it('draws every course with its visit link and clinic-local issue time', async () => {
    renderSection({ prescriptions: PRESCRIPTIONS });

    const rows = await screen.findAllByTestId('patient-prescription');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Amoxicillin · 500 mg');
    expect(rows[0]).toHaveTextContent('Oral · Every 8 hours · 7 days');
    expect(rows[0]).toHaveTextContent('Finish the course.');
    expect(rows[0]).toHaveTextContent('08:00');
    expect(rows[0]?.querySelector('a')).toHaveAttribute('href', '/visits/visit-2');
    expect(rows[1]).toHaveTextContent('Ibuprofen · 400 mg');
  });

  it('distinguishes an empty history from a failed read', async () => {
    const empty = renderSection();
    expect(
      await screen.findByText('No prescriptions recorded for this patient.'),
    ).toBeInTheDocument();
    empty.fetchImplementation.mockClear();

    renderSection({
      failure: {
        status: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 't' } },
      },
    });
    expect(await screen.findByText('The prescriptions could not be loaded.')).toBeInTheDocument();
  });
});
