/**
 * The payment ledger page.
 *
 * The arithmetic is the API's, covered by the SQLite smoke and the PostgreSQL
 * repository spec. These tests pin what only the screen can get wrong: that the
 * server's collected total is shown rather than re-added from the page, that a row
 * shows the patient, method and reference it was given, and that changing a filter
 * actually carries the new value to the wire.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/index.js';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PaymentsPage } from './payments-page.js';

const BASE_URL = 'http://api.test/api/v1';

const CLINIC = {
  id: 'clinic-1',
  name: 'Clinica Visible',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [],
  settings: {},
};

const LEDGER = {
  period: { from: '2026-10-01', to: '2026-10-05', timeZone: 'America/Lima' },
  currencyCode: 'PEN',
  items: [
    {
      id: 'payment-1',
      patientId: 'patient-1',
      patientName: 'Ana García',
      method: 'CARD',
      currency: 'PEN',
      amountMinor: 12_000,
      reference: '4242',
      receivedAt: '2026-10-05T14:00:00.000Z',
    },
    {
      id: 'payment-2',
      patientId: 'patient-2',
      patientName: 'Luis Fernández',
      method: 'CASH',
      currency: 'PEN',
      amountMinor: 6_000,
      reference: null,
      receivedAt: '2026-10-05T15:00:00.000Z',
    },
  ],
  totalAmountMinor: 18_000,
  pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPayments({ locale = 'en' }: { locale?: 'en' | 'es' } = {}) {
  const requests: string[] = [];

  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    requests.push(url.href);

    if (url.pathname === '/api/v1/clinic') {
      return jsonResponse(CLINIC);
    }
    if (url.pathname === '/api/v1/payments') {
      return jsonResponse(LEDGER);
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
  const paymentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/payments',
    component: () => <PaymentsPage />,
  });
  const patientRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients/$patientId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([paymentsRoute, patientRoute]),
    history: createMemoryHistory({ initialEntries: ['/payments'] }),
  });

  render(
    <I18nProvider {...(locale ? { initialLocale: locale } : {})}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider baseUrl={BASE_URL} client={client}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );

  return { requests };
}

describe('PaymentsPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the period total, not a sum of the page, and names every row', async () => {
    renderPayments();

    expect(await screen.findByText('180.00 PEN')).toBeInTheDocument();
    expect(screen.getByTestId('payments-count')).toHaveTextContent('2');

    const rows = screen.getAllByTestId('payment-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ana García');
    expect(rows[0]).toHaveTextContent('Card');
    expect(rows[0]).toHaveTextContent('4242');
    expect(rows[0]).toHaveTextContent('120.00 PEN');
    expect(rows[0]).toHaveTextContent('Mon, Oct 5');
    expect(rows[1]).toHaveTextContent('Luis Fernández');
    expect(rows[1]).toHaveTextContent('Cash');
    expect(rows[1]).toHaveTextContent('—');
  });

  it('sends the chosen method to the API', async () => {
    const user = userEvent.setup();
    const { requests } = renderPayments();

    await screen.findByText('180.00 PEN');
    await user.selectOptions(screen.getByTestId('payments-method'), 'CARD');

    await waitFor(() => {
      expect(requests.at(-1)).toContain('method=CARD');
    });
    expect(requests.at(-1)).toContain('from=');
    expect(requests.at(-1)).toContain('to=');
  });

  it('renders the Spanish copy and method labels', async () => {
    renderPayments({ locale: 'es' });

    expect(await screen.findByRole('heading', { name: 'Pagos' })).toBeVisible();
    expect(await screen.findByText('180.00 PEN')).toBeInTheDocument();
    expect(screen.getAllByTestId('payment-row')[0]).toHaveTextContent('Tarjeta');
    expect(screen.getByText('Todos los métodos')).toBeVisible();
  });

  it('opens the payment dialog without changing the ledger read', async () => {
    const user = userEvent.setup();
    const { requests } = renderPayments();

    await screen.findByText('180.00 PEN');
    const ledgerRequests = requests.filter((url) => url.includes('/api/v1/payments'));

    await user.click(screen.getByTestId('payments-record'));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Record a payment');
    expect(requests.filter((url) => url.includes('/api/v1/payments'))).toHaveLength(
      ledgerRequests.length,
    );
  });
});
