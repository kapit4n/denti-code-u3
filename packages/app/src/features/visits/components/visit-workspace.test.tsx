/**
 * Tests for the visit workspace.
 *
 * What is being pinned down is the screen's honesty about three things it could
 * easily guess instead: the clinic's clock, the names behind the visit's ids, and
 * which buttons exist. Each has a defect that renders plausibly — 14:00 instead of
 * 09:00, a uuid instead of a clinician, a "Cancel visit" that 404s — and none of
 * them throws, so nothing short of rendering the page catches them.
 *
 * The workspace is rendered with a real `ApiClient` and a stub `fetch` that routes
 * by method and path, so the requests are asserted as they go over the wire: a
 * screen that shows "Completed" without posting, or posts a body the endpoints
 * never read, is the failure this is here to catch.
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
import { describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { VisitWorkspace } from './visit-workspace.js';

const BASE_URL = 'http://api.test/api/v1';

const VISIT_ID = 'visit-1';
const PATIENT_ID = 'patient-1';

const OPEN_VISIT = {
  id: VISIT_ID,
  clinicId: 'clinic-1',
  patientId: PATIENT_ID,
  dentistId: 'dentist-1',
  appointmentId: 'appointment-1',
  chairId: 'chair-1',
  startedAt: '2026-10-05T14:00:00.000Z',
  status: 'OPEN',
};

const COMPLETED_VISIT = {
  ...OPEN_VISIT,
  status: 'COMPLETED',
  endedAt: '2026-10-05T15:00:00.000Z',
};

const PROFILE = {
  id: PATIENT_ID,
  recordNumber: 'P-000001',
  firstName: 'Ana',
  lastName: 'García',
  preferredName: null,
};

const CLINIC = { timeZone: 'America/Lima' };

const DENTISTS = {
  items: [
    { id: 'dentist-1', fullName: 'Dra. Rivera', speciality: null, color: null, isActive: true },
  ],
};

const CHAIRS = {
  items: [
    {
      id: 'chair-1',
      roomId: 'room-1',
      roomName: 'Sala 1',
      name: 'Sillón 1',
      isActive: true,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  /** The visit the API answers with, before any closure. */
  readonly visit?: Record<string, unknown>;
  readonly visitStatus?: number;
  /**
   * What a successful closure does: the row the POST answers with *and* the row the
   * invalidated query refetches. One field for both because the API's promise is
   * that they are the same row — a harness where they differ would hide exactly the
   * bug the refetch exists to catch.
   */
  readonly visitAfterClosure?: Record<string, unknown>;
  /** When set, every closure POST is refused with this envelope. */
  readonly closureRefusal?: { readonly status: number; readonly body: unknown };
  /** `null` makes the patient profile 404, as an anonymised record does. */
  readonly profile?: Record<string, unknown> | null;
}

function renderWorkspace({
  visit = OPEN_VISIT,
  visitStatus = 200,
  visitAfterClosure,
  closureRefusal,
  profile = PROFILE,
}: HarnessOptions = {}) {
  const state = { visit };

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (method === 'GET' && path === `/api/v1/visits/${VISIT_ID}`) {
      return jsonResponse(state.visit, visitStatus);
    }
    if (method === 'GET' && path === `/api/v1/patients/${PATIENT_ID}`) {
      return profile === null
        ? jsonResponse({ error: { code: 'NOT_FOUND', message: 'gone', requestId: 'test' } }, 404)
        : jsonResponse(profile);
    }
    if (method === 'GET' && path === '/api/v1/clinic') {
      return jsonResponse(CLINIC);
    }
    if (method === 'GET' && path === '/api/v1/dentists') {
      return jsonResponse(DENTISTS);
    }
    if (method === 'GET' && path === '/api/v1/chairs') {
      return jsonResponse(CHAIRS);
    }
    if (method === 'POST' && path.startsWith(`/api/v1/visits/${VISIT_ID}/`)) {
      if (closureRefusal) {
        return jsonResponse(closureRefusal.body, closureRefusal.status);
      }
      if (visitAfterClosure) {
        state.visit = visitAfterClosure;
        return jsonResponse(visitAfterClosure);
      }
    }
    // Loud rather than a network error: a request this harness did not expect is a
    // defect in the test or in the component, and the ApiClient would otherwise
    // swallow it into a NETWORK_ERROR the assertions never look at.
    return jsonResponse(
      {
        error: { code: 'INTERNAL_ERROR', message: `Unexpected ${method} ${path}`, requestId: 't' },
      },
      501,
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  /*
   * A router, because the workspace is full of links and `<Link>` outside one
   * throws. Three routes and no root component: the point of this harness is the
   * workspace's own requests and sentences, not the shell around it. The visits
   * route renders the workspace from its own param, so what is exercised is the
   * wiring a browser would take — `to="/patients/$patientId"` resolving with this
   * visit's patient in it.
   */
  const rootRoute = createRootRoute({});
  const patientsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/patients' });
  const patientRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients/$patientId',
  });
  const visitRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits/$visitId',
    component: () => <VisitWorkspace visitId={VISIT_ID} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([patientsRoute, patientRoute, visitRoute]),
    history: createMemoryHistory({ initialEntries: [`/visits/${VISIT_ID}`] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

describe('VisitWorkspace', () => {
  it('says who was treated, when, by whom and where — in the clinic’s timezone', async () => {
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Ana García' })).toBeTruthy();
    expect(screen.getByText('P-000001 · Started from a booking')).toBeTruthy();
    expect(screen.getByTestId('visit-status')).toHaveTextContent('Open');

    // 14:00Z is 09:00 in Lima. A workspace quoting 14:00 would be quoting the
    // server's storage, not the clinic's day.
    const started = screen.getByText('Started').nextElementSibling;
    expect(started?.textContent).toContain('09:00');
    expect(started?.textContent).not.toContain('14:00');
    expect(screen.getByText('Not finished yet')).toBeTruthy();

    // Names, not ids: the visit carries ids, and a uuid under "Clinician" identifies
    // nobody.
    expect(screen.getByText('Dra. Rivera')).toBeTruthy();
    expect(screen.getByText('Sillón 1 · Sala 1')).toBeTruthy();
    expect(screen.getByText('No clinical summary recorded.')).toBeTruthy();
  });

  it('offers the one closure the domain allows and the API implements', async () => {
    renderWorkspace();

    await screen.findByTestId('complete-visit');
    // OPEN may be completed (and cancelled — but no endpoint performs a
    // cancellation, so no button may offer one).
    expect(screen.queryByTestId('reopen-visit')).toBeNull();
    expect(screen.queryByText(/cannot be reopened/)).toBeNull();
  });

  it('completes a visit and redraws from the server’s answer', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderWorkspace({ visitAfterClosure: COMPLETED_VISIT });

    await user.click(await screen.findByTestId('complete-visit'));

    // The POST is bodyless: both endpoints read nothing, and a JSON body they never
    // parse is a place a client could believe a field was accepted.
    await waitFor(() => {
      const post = fetchImplementation.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith(`/visits/${VISIT_ID}/complete`) &&
          (init?.method ?? 'GET').toUpperCase() === 'POST',
      );
      expect(post).toBeTruthy();
      expect(post?.[1]?.body).toBeUndefined();
    });

    // Nothing is written optimistically: the chip changes because the invalidated
    // query refetched, and the server's own row is what is on screen.
    expect(await screen.findByTestId('visit-status')).toHaveTextContent('Completed');
    expect(await screen.findByTestId('reopen-visit')).toBeTruthy();
    expect(screen.queryByTestId('complete-visit')).toBeNull();

    // The patient's profile carries this visit too, so it is refetched with it.
    const profileCalls = fetchImplementation.mock.calls.filter(
      ([url]) => String(url) === `${BASE_URL}/patients/${PATIENT_ID}`,
    );
    expect(profileCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the visit on screen and says why when the server refuses', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderWorkspace({
      closureRefusal: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'Visit cannot move from OPEN to COMPLETED',
            requestId: 'test',
          },
        },
      },
    });

    await user.click(await screen.findByTestId('complete-visit'));

    // The refusal is shown in the server's own words — the wire code collapses every
    // rule refusal into one, so the message is the only place that says why — and
    // the record underneath is still the one the server holds.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Visit cannot move from OPEN to COMPLETED',
    );
    expect(screen.getByTestId('visit-status')).toHaveTextContent('Open');
    expect(fetchImplementation).toHaveBeenCalled();
  });

  it('treats a cancelled visit as history rather than offering it no buttons', async () => {
    renderWorkspace({ visit: { ...OPEN_VISIT, status: 'CANCELLED' } });

    expect(await screen.findByText(/cannot be reopened/)).toBeTruthy();
    expect(screen.queryByTestId('complete-visit')).toBeNull();
    expect(screen.queryByTestId('reopen-visit')).toBeNull();
  });

  it('names a walk-in as such, because there is no booking behind it', async () => {
    const { appointmentId: _dropped, ...walkIn } = OPEN_VISIT;
    renderWorkspace({ visit: walkIn });

    expect(await screen.findByText(/· Walk-in$/)).toBeTruthy();
    expect(screen.queryByText(/Started from a booking/)).toBeNull();
  });

  it('shows the workspace when the patient profile cannot be read', async () => {
    // A visit outlives the record it names — an anonymised profile answers 404 — and
    // the clinical facts are still the clinician's to see. Both assertions wait: the
    // workspace renders while the profile query is still settling, and "still
    // loading" and "cannot be read" look alike for exactly one render.
    renderWorkspace({ profile: null });

    expect(await screen.findByTestId('visit-workspace')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Patient record unavailable' })).toBeTruthy();
    expect(await screen.findByText('Dra. Rivera')).toBeTruthy();
  });

  it('says a visit this clinic does not hold is not here, and offers a way back', async () => {
    renderWorkspace({
      visit: {},
      visitStatus: 404,
    });

    expect(
      await screen.findByText('This visit does not exist in the current clinic.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /All patients/ })).toBeTruthy();
    expect(screen.queryByTestId('visit-workspace')).toBeNull();
  });

  it('marks the section it is drawing, from a nav that holds real sections only', async () => {
    renderWorkspace();

    const summary = await screen.findByTestId('visit-section-summary');
    expect(summary).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation', { name: 'Visit sections' })).toBeTruthy();
  });
});
