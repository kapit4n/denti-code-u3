/**
 * Tests for the visit directory.
 *
 * What is pinned down is what the screen could quietly get wrong: the clinic's clock
 * instead of the visitor's, the status vocabulary instead of the enum, the total the
 * server counted instead of the page length, and a page change that refetches rather
 * than re-slicing rows already in hand. None of those throws when wrong.
 *
 * The screen is rendered with a real `ApiClient` and a stub `fetch`, so the page
 * change is asserted as a request — `page=2` on the wire — not as a state variable.
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

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { VisitList } from './visit-list.js';

const BASE_URL = 'http://api.test/api/v1';

const CLINIC = { timeZone: 'America/Lima' };

const VISITS = [
  {
    id: 'visit-2',
    patientId: 'patient-1',
    patientName: 'Ana García',
    dentistId: 'dentist-1',
    dentistName: 'Dra. Rivera',
    status: 'COMPLETED',
    startedAt: '2026-10-05T14:00:00.000Z',
    endedAt: '2026-10-05T15:00:00.000Z',
  },
  {
    id: 'visit-1',
    patientId: 'patient-2',
    patientName: 'Beto Silva',
    dentistId: null,
    dentistName: null,
    status: 'OPEN',
    startedAt: null,
    endedAt: null,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDirectory(options: { visits?: readonly unknown[]; total?: number } = {}) {
  const visits = options.visits ?? VISITS;
  const total = options.total ?? visits.length;
  const reads: URL[] = [];

  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/clinic') {
      return jsonResponse(CLINIC);
    }
    if (url.pathname === '/api/v1/visits') {
      reads.push(url);
      const page = Number(url.searchParams.get('page') ?? 1);
      return jsonResponse({
        items: page === 1 ? visits : [],
        pagination: { page, limit: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
      });
    }
    return jsonResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'Unexpected request', requestId: 'test' } },
      501,
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const rootRoute = createRootRoute({});
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits',
    component: () => <VisitList />,
  });
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits/$visitId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, workspaceRoute]),
    history: createMemoryHistory({ initialEntries: ['/visits'] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { reads, router };
}

describe('VisitList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders names, statuses and the clinic’s clock', async () => {
    renderDirectory();

    expect(await screen.findByRole('link', { name: 'Ana García' })).toBeInTheDocument();
    expect(screen.getByText('Dra. Rivera')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    // A visit with no clinician and no start is a row, not a gap.
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('2 on record')).toBeInTheDocument();

    // 14:00 UTC in Lima is 09:00. The visitor's zone must not be what is drawn.
    await waitFor(() => expect(screen.getByText(/09:00/)).toBeInTheDocument());
    expect(screen.queryByText(/14:00/)).not.toBeInTheDocument();
  });

  it('asks the server for the next page instead of re-slicing', async () => {
    const user = userEvent.setup();
    const { reads } = renderDirectory({ total: 21 });

    await screen.findByRole('link', { name: 'Ana García' });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(reads.some((url) => url.searchParams.get('page') === '2')).toBe(true);
    });
    expect(reads[0]?.searchParams.get('page')).toBe('1');
  });

  it('says the record is empty rather than drawing an empty table', async () => {
    renderDirectory({ visits: [], total: 0 });

    expect(await screen.findByText(/No visits on record yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
