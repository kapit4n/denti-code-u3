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
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const TREATMENTS_ITEMS: Record<string, unknown>[] = [
  {
    id: 'treatment-1',
    code: 'COMPO',
    name: 'Composite filling',
    description: null,
    defaultDurationMinutes: 45,
    defaultPriceMinor: 25000,
    isActive: true,
  },
  {
    id: 'treatment-2',
    code: null,
    name: 'Scaling and prophylaxis',
    description: 'Deep cleaning of the teeth and gums.',
    defaultDurationMinutes: 30,
    defaultPriceMinor: 40000,
    isActive: true,
  },
];

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
  /** The notes the API answers with when the notes section is opened. */
  readonly notes?: Record<string, unknown>[];
  /** When set, filing a note is refused with this envelope. */
  readonly noteRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the note POST waits on before it answers, so a test can look at the
   * screen while the request is still in flight. Without it, "not written
   * optimistically" has no moment to be observed at.
   */
  readonly noteGate?: Promise<void>;
  /** The files the API answers with when the files section is opened. */
  readonly visitAttachments?: Record<string, unknown>[];
  /** When set, attaching a file is refused with this envelope. */
  readonly attachmentRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the attachment POST waits on before it answers, so a test can look at
   * the screen while the request is still in flight.
   */
  readonly attachmentGate?: Promise<void>;
  /** The catalogue the `/treatments` read answers with when the section opens. */
  readonly catalogue?: Record<string, unknown>[];
  /** The treatments the API answers with when the treatments section is opened. */
  readonly visitTreatments?: Record<string, unknown>[];
  /** When set, recording a treatment is refused with this envelope. */
  readonly treatmentRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the treatment POST waits on before it answers, so a test can look at
   * the screen while the request is still in flight.
   */
  readonly treatmentGate?: Promise<void>;
  /** The prescriptions the API answers with when the prescriptions section is opened. */
  readonly visitPrescriptions?: Record<string, unknown>[];
  /** When set, writing a prescription is refused with this envelope. */
  readonly prescriptionRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the prescription POST waits on before it answers, so a test can look
   * at the screen while the request is still in flight.
   */
  readonly prescriptionGate?: Promise<void>;
  /** The charges the API answers with when the charges section is opened. */
  readonly visitCharges?: Record<string, unknown>[];
  /** When set, raising a charge is refused with this envelope. */
  readonly chargeRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the charge POST waits on before it answers, so a test can look at
   * the screen while the request is still in flight.
   */
  readonly chargeGate?: Promise<void>;
  /** The payments the API answers with when the payments section is opened. */
  readonly visitPayments?: Record<string, unknown>[];
  /** When set, recording a payment is refused with this envelope. */
  readonly paymentRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the payment POST waits on before it answers, so a test can look at
   * the screen while the request is still in flight.
   */
  readonly paymentGate?: Promise<void>;
}

function renderWorkspace({
  visit = OPEN_VISIT,
  visitStatus = 200,
  visitAfterClosure,
  closureRefusal,
  profile = PROFILE,
  notes = [],
  noteRefusal,
  noteGate,
  visitAttachments = [],
  attachmentRefusal,
  attachmentGate,
  catalogue = TREATMENTS_ITEMS,
  visitTreatments = [],
  treatmentRefusal,
  treatmentGate,
  visitPrescriptions = [],
  prescriptionRefusal,
  prescriptionGate,
  visitCharges = [],
  chargeRefusal,
  chargeGate,
  visitPayments = [],
  paymentRefusal,
  paymentGate,
}: HarnessOptions = {}) {
  const state = {
    visit,
    notes: [...notes],
    visitAttachments: [...visitAttachments],
    visitTreatments: [...visitTreatments],
    visitPrescriptions: [...visitPrescriptions],
    visitCharges: [...visitCharges],
    visitPayments: [...visitPayments],
  };

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (method === 'GET' && path === `/api/v1/visits/${VISIT_ID}`) {
      return jsonResponse(state.visit, visitStatus);
    }
    // The notes are routed before the closure branch below, which matches any path
    // under the visit — `/notes` would otherwise be read as a closure and answered
    // with the visit itself.
    if (path === `/api/v1/visits/${VISIT_ID}/notes` && method === 'GET') {
      return jsonResponse({ notes: state.notes });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/notes` && method === 'POST') {
      if (noteRefusal) {
        return jsonResponse(noteRefusal.body, noteRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as { body: string };
      const note = {
        id: `note-${state.notes.length + 1}`,
        visitId: VISIT_ID,
        authorId: null,
        body: written.body,
        createdAt: '2026-10-05T14:35:00.000Z',
      };
      state.notes = [...state.notes, note];
      // The answer waits on the gate: the request has been made, and the screen has
      // not been told about it yet.
      await noteGate;
      return jsonResponse(note, 201);
    }
    if (path === `/api/v1/visits/${VISIT_ID}/attachments` && method === 'GET') {
      return jsonResponse({ attachments: state.visitAttachments });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/attachments` && method === 'POST') {
      if (attachmentRefusal) {
        return jsonResponse(attachmentRefusal.body, attachmentRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as {
        fileName: string;
        contentType?: string;
        sizeBytes?: number;
      };
      const attached = {
        id: `attachment-${state.visitAttachments.length + 1}`,
        visitId: VISIT_ID,
        fileName: written.fileName,
        contentType: written.contentType ?? null,
        sizeBytes: written.sizeBytes ?? null,
        createdAt: '2026-10-05T14:35:00.000Z',
      };
      state.visitAttachments = [...state.visitAttachments, attached];
      // The answer waits on the gate: the request has been made, and the screen has
      // not been told about it yet.
      await attachmentGate;
      return jsonResponse(attached, 201);
    }
    // The catalogue is its own read; the visit's treatments are routed by their own
    // path before the closure branch below, which matches any path under the visit.
    if (method === 'GET' && path === '/api/v1/treatments') {
      return jsonResponse({ items: catalogue });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/treatments` && method === 'GET') {
      return jsonResponse({ treatments: state.visitTreatments });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/treatments` && method === 'POST') {
      if (treatmentRefusal) {
        return jsonResponse(treatmentRefusal.body, treatmentRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as {
        treatmentId: string;
        tooth?: string;
        notes?: string;
      };
      const performed = {
        id: `treatment-${state.visitTreatments.length + 1}`,
        visitId: VISIT_ID,
        treatmentId: written.treatmentId,
        tooth: written.tooth ?? null,
        notes: written.notes ?? null,
        performedAt: '2026-10-05T14:35:00.000Z',
      };
      state.visitTreatments = [...state.visitTreatments, performed];
      // The answer waits on the gate: the request has been made, and the screen has
      // not been told about it yet.
      await treatmentGate;
      return jsonResponse(performed, 201);
    }
    if (path === `/api/v1/visits/${VISIT_ID}/prescriptions` && method === 'GET') {
      return jsonResponse({ prescriptions: state.visitPrescriptions });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/prescriptions` && method === 'POST') {
      if (prescriptionRefusal) {
        return jsonResponse(prescriptionRefusal.body, prescriptionRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as {
        medication: string;
        dosage: string;
        route: string;
        frequency: string;
        durationDays: number;
        instructions?: string;
      };
      const filed = {
        id: `prescription-${state.visitPrescriptions.length + 1}`,
        visitId: VISIT_ID,
        patientId: PATIENT_ID,
        dentistId: 'dentist-1',
        issuedAt: '2026-10-05T14:35:00.000Z',
        medication: written.medication,
        dosage: written.dosage,
        route: written.route,
        frequency: written.frequency,
        durationDays: written.durationDays,
        instructions: written.instructions ?? null,
      };
      state.visitPrescriptions = [...state.visitPrescriptions, filed];
      // The answer waits on the gate: the request has been made, and the screen has
      // not been told about it yet.
      await prescriptionGate;
      return jsonResponse(filed, 201);
    }
    if (path === `/api/v1/visits/${VISIT_ID}/charges` && method === 'GET') {
      return jsonResponse({ charges: state.visitCharges });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/charges` && method === 'POST') {
      if (chargeRefusal) {
        return jsonResponse(chargeRefusal.body, chargeRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as {
        description: string;
        quantity?: number;
        unitPriceMinor: number;
        discountMinor?: number;
      };
      const raised = {
        id: `charge-${state.visitCharges.length + 1}`,
        clinicId: 'clinic-1',
        patientId: PATIENT_ID,
        visitId: VISIT_ID,
        invoiceId: null,
        invoicedAt: null,
        createdAt: '2026-10-05T14:35:00.000Z',
        treatmentId: null,
        description: written.description,
        quantity: written.quantity ?? 1,
        unitPriceMinor: written.unitPriceMinor,
        discountMinor: written.discountMinor ?? 0,
        taxRatePercent: 0,
        currency: 'USD',
      };
      state.visitCharges = [...state.visitCharges, raised];
      await chargeGate;
      return jsonResponse(raised, 201);
    }
    if (path === `/api/v1/visits/${VISIT_ID}/payments` && method === 'GET') {
      return jsonResponse({ payments: state.visitPayments });
    }
    if (path === `/api/v1/visits/${VISIT_ID}/payments` && method === 'POST') {
      if (paymentRefusal) {
        return jsonResponse(paymentRefusal.body, paymentRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as {
        method: string;
        amountMinor: number;
        reference?: string;
      };
      const recorded = {
        id: `payment-${state.visitPayments.length + 1}`,
        clinicId: 'clinic-1',
        patientId: PATIENT_ID,
        method: written.method,
        currency: state.visitCharges[0]?.currency ?? 'USD',
        amountMinor: written.amountMinor,
        reference: written.reference ?? null,
        receivedAt: '2026-10-05T14:35:00.000Z',
      };
      state.visitPayments = [...state.visitPayments, recorded];
      // The server's promise, kept the same way the closure keeps it: a settlement
      // folds every un-invoiced charge into an invoice and stamps it, so the charges
      // list the invalidation refetches answers with them invoiced — one row for
      // both the answer and the refetch, so a harness where they differ could not
      // catch the divergence it is built to catch.
      state.visitCharges = state.visitCharges.map((charge) => ({
        ...charge,
        invoiceId: charge.invoiceId ?? 'invoice-1',
        invoicedAt: charge.invoicedAt ?? '2026-10-05T14:35:00.000Z',
      }));
      // The answer waits on the gate: the request has been made, and the screen has
      // not been told about it yet.
      await paymentGate;
      return jsonResponse(recorded, 201);
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
  /**
   * Radix sets `body { pointer-events: none }` while one of its dropdowns is open, and
   * user-event honours it — refusing to click anything afterwards. jsdom never runs the
   * close animation that takes the attribute back off, so the setting survives the
   * interaction that caused it and every later click in the test is refused. The check
   * is turned off for the whole block, the same trade the booking dialog makes.
   */
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup({ pointerEventsCheck: 0 });

    // Radix positions its content with these, and jsdom implements neither. The
    // workspace's own behaviour does not depend on either, so a stub is honest
    // here rather than a workaround — the same trade the booking dialog makes.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = vi.fn();
    // Radix scrolls the chosen option into view with the window handle; jsdom
    // reports it as unimplemented for every open, which is noise, not a defect.
    vi.stubGlobal('scrollTo', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Picks an option from a Radix select. */
  async function chooseFrom(trigger: string, optionName: RegExp): Promise<void> {
    await user.click(screen.getByTestId(trigger));
    await user.click(await screen.findByRole('option', { name: optionName }));
  }

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

  it('lists the notes on the visit, in the clinic’s clock, only once the section is open', async () => {
    const { fetchImplementation } = renderWorkspace({
      notes: [
        {
          id: 'note-1',
          visitId: VISIT_ID,
          authorId: null,
          body: 'Sensitivity reported on the upper right quadrant.',
          createdAt: '2026-10-05T14:00:00.000Z',
        },
      ],
    });

    // The summary is what the workspace opens on, and the notes were not asked for:
    // a request whose answer no pixel can show is a request waiting to be stale.
    await screen.findByTestId('visit-workspace');
    expect(
      fetchImplementation.mock.calls.filter(([url]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/notes`),
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('visit-section-notes'));

    expect(await screen.findByTestId('clinical-note')).toHaveTextContent(
      'Sensitivity reported on the upper right quadrant.',
    );
    // 14:00Z is 09:00 in Lima — the clinic's hour again, on a note this time.
    expect(screen.getByTestId('clinical-note')).toHaveTextContent('09:00');
    expect(screen.getByTestId('clinical-note')).not.toHaveTextContent('14:00');
    expect(screen.queryByText('No notes yet.')).toBeNull();
  });

  it('says there are no notes rather than showing an empty list as an error', async () => {
    renderWorkspace({ notes: [] });

    await user.click(await screen.findByTestId('visit-section-notes'));

    expect(await screen.findByText('No notes yet.')).toBeTruthy();
    expect(screen.queryByTestId('clinical-note')).toBeNull();
  });

  it('files a note and shows it only once the server has answered', async () => {
    let release: () => void = () => {};
    const noteGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderWorkspace({ notes: [], noteGate });

    await user.click(await screen.findByTestId('visit-section-notes'));
    await screen.findByText('No notes yet.');

    await user.type(screen.getByTestId('note-body'), 'Sensitivity to cold on 16.');
    await user.click(screen.getByTestId('add-note'));

    // The POST is on the wire and the note is not on screen: nothing is written
    // optimistically, because a note the API has not accepted is not a clinical
    // record.
    expect(screen.queryByTestId('clinical-note')).toBeNull();
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/notes`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, so the server is not asked to store what the box's
    // edges happen to hold.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ body: 'Sensitivity to cold on 16.' });

    release();

    // The invalidation refetched the list, and the server's row is what is on screen.
    expect(await screen.findByTestId('clinical-note')).toHaveTextContent(
      'Sensitivity to cold on 16.',
    );
    // The draft is cleared on success, and only there.
    expect(screen.getByTestId('note-body')).toHaveValue('');

    // Filing a note changes nothing about the visit itself, so neither the visit nor
    // the patient's profile was refetched — invalidating `['visits']` wholesale would
    // have done both for pixels that cannot differ.
    const visitReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(visitReads).toHaveLength(1);
  });

  it('keeps what the clinician typed and says why when the note is refused', async () => {
    const { fetchImplementation } = renderWorkspace({
      noteRefusal: {
        status: 422,
        body: {
          error: { code: 'VALIDATION_ERROR', message: 'A note needs a body', requestId: 'test' },
        },
      },
    });

    await user.click(await screen.findByTestId('visit-section-notes'));
    await user.type(screen.getByTestId('note-body'), 'Half a thought');
    await user.click(screen.getByTestId('add-note'));

    // The refusal reaches the screen in the API's own words, and the text is still
    // there: a network error that took the clinician's paragraph with it would be the
    // most destructive thing this panel does.
    expect(await screen.findByRole('alert')).toHaveTextContent('A note needs a body');
    expect(screen.getByTestId('note-body')).toHaveValue('Half a thought');
    expect(fetchImplementation).toHaveBeenCalled();
    expect(screen.queryByTestId('clinical-note')).toBeNull();
  });

  it('lists the files on the visit, in the clinic’s clock, only once the section is open', async () => {
    const { fetchImplementation } = renderWorkspace({
      visitAttachments: [
        {
          id: 'attachment-1',
          visitId: VISIT_ID,
          fileName: 'periapical-26.png',
          contentType: 'image/png',
          sizeBytes: 512400,
          createdAt: '2026-10-05T14:00:00.000Z',
        },
      ],
    });

    // The summary is what the workspace opens on, and the files were not asked for.
    await screen.findByTestId('visit-workspace');
    expect(
      fetchImplementation.mock.calls.filter(([url]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/attachments`),
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('visit-section-attachments'));

    expect(await screen.findByTestId('attachment')).toHaveTextContent('periapical-26.png');
    expect(screen.getByTestId('attachment')).toHaveTextContent('image/png');
    expect(screen.getByTestId('attachment')).toHaveTextContent('512400 bytes');
    // 14:00Z is 09:00 in Lima — the clinic's hour again, on a file this time.
    expect(screen.getByTestId('attachment')).toHaveTextContent('09:00');
    expect(screen.getByTestId('attachment')).not.toHaveTextContent('14:00');
    expect(screen.queryByText('No files attached yet.')).toBeNull();
  });

  it('says there are no files rather than showing an empty list as an error', async () => {
    renderWorkspace({ visitAttachments: [] });

    await user.click(await screen.findByTestId('visit-section-attachments'));

    expect(await screen.findByText('No files attached yet.')).toBeTruthy();
    expect(screen.queryByTestId('attachment')).toBeNull();
  });

  it('attaches a file and shows it only once the server has answered', async () => {
    let release: () => void = () => {};
    const attachmentGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderWorkspace({ visitAttachments: [], attachmentGate });

    await user.click(await screen.findByTestId('visit-section-attachments'));
    await screen.findByText('No files attached yet.');

    await user.type(screen.getByTestId('attachment-name'), '  Periapical-26.png  ');
    await user.type(screen.getByTestId('attachment-content-type'), 'Image/PNG');
    await user.type(screen.getByTestId('attachment-size'), '512400');
    await user.click(screen.getByTestId('attach-file'));

    // The POST is on the wire and the file is not on screen: nothing is written
    // optimistically, because a file the API has not accepted is not a clinical
    // record.
    expect(screen.queryByTestId('attachment')).toBeNull();
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/attachments`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, so the server is not asked to store what the box's
    // edges happen to hold.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      fileName: 'Periapical-26.png',
      contentType: 'Image/PNG',
      sizeBytes: 512400,
    });

    release();

    // The invalidation refetched the list, and the server's row is what is on screen.
    expect(await screen.findByTestId('attachment')).toHaveTextContent('Periapical-26.png');
    // The draft is cleared on success, and only there.
    expect(screen.getByTestId('attachment-name')).toHaveValue('');
    expect(screen.getByTestId('attachment-content-type')).toHaveValue('');
    // A number box's empty value is null, not an empty string.
    expect(screen.getByTestId('attachment-size')).toHaveValue(null);

    // Attaching a file changes nothing about the visit itself, so neither the visit
    // nor the patient's profile was refetched — invalidating `['visits']` wholesale
    // would have done both for pixels that cannot differ.
    const visitReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(visitReads).toHaveLength(1);
  });

  it('keeps what the front desk typed and says why when the file is refused', async () => {
    const { fetchImplementation } = renderWorkspace({
      attachmentRefusal: {
        status: 422,
        body: {
          error: { code: 'VALIDATION_ERROR', message: 'A file needs a name', requestId: 'test' },
        },
      },
    });

    await user.click(await screen.findByTestId('visit-section-attachments'));
    await user.type(screen.getByTestId('attachment-name'), 'Half a name');
    await user.click(screen.getByTestId('attach-file'));

    // The refusal reaches the screen in the API's own words, and the text is still
    // there: a network error that took the front desk's draft with it would be the
    // most destructive thing this panel does.
    expect(await screen.findByRole('alert')).toHaveTextContent('A file needs a name');
    expect(screen.getByTestId('attachment-name')).toHaveValue('Half a name');
    expect(fetchImplementation).toHaveBeenCalled();
    expect(screen.queryByTestId('attachment')).toBeNull();
  });

  it('lists the treatments recorded on the visit, in the clinic’s clock, only once the section is open', async () => {
    const { fetchImplementation } = renderWorkspace({
      visitTreatments: [
        {
          id: 'treatment-record-1',
          visitId: VISIT_ID,
          treatmentId: 'treatment-1',
          tooth: '16',
          notes: 'Sensitivity to cold on 16.',
          performedAt: '2026-10-05T14:00:00.000Z',
        },
      ],
    });

    // The summary is what the workspace opens on, and neither the catalogue nor the
    // treatments were asked for: a request whose answer no pixel can show is a
    // request waiting to be stale.
    await screen.findByTestId('visit-workspace');
    expect(
      fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/treatments')),
    ).toHaveLength(0);
    expect(
      fetchImplementation.mock.calls.filter(([url]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/treatments`),
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('visit-section-treatments'));

    // The name comes from the catalogue — the record carries an id, and a name is
    // the offer's to give — and the tooth and notes travel with the record.
    expect(await screen.findByTestId('treatment-record')).toHaveTextContent('Composite filling');
    expect(screen.getByTestId('treatment-record')).toHaveTextContent('Tooth 16');
    expect(screen.getByTestId('treatment-record')).toHaveTextContent('Sensitivity to cold on 16.');
    // 14:00Z is 09:00 in Lima — the clinic's hour again, on a record this time.
    expect(screen.getByTestId('treatment-record')).toHaveTextContent('09:00');
    expect(screen.getByTestId('treatment-record')).not.toHaveTextContent('14:00');
    expect(screen.queryByText('No treatments recorded yet.')).toBeNull();
  });

  it('says there are no recorded treatments rather than showing an empty list as an error', async () => {
    renderWorkspace({ visitTreatments: [] });

    await user.click(await screen.findByTestId('visit-section-treatments'));

    expect(await screen.findByText('No treatments recorded yet.')).toBeTruthy();
    expect(screen.queryByTestId('treatment-record')).toBeNull();
  });

  it('records a treatment and shows it only once the server has answered', async () => {
    let release: () => void = () => {};
    const treatmentGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderWorkspace({ visitTreatments: [], treatmentGate });

    await user.click(await screen.findByTestId('visit-section-treatments'));
    await screen.findByText('No treatments recorded yet.');

    await chooseFrom('treatment-catalogue', /Composite filling/);
    await user.type(screen.getByTestId('treatment-tooth'), '16');
    await user.type(screen.getByTestId('treatment-notes'), '  Composite on 16.  ');
    await user.click(screen.getByTestId('record-treatment'));

    // The POST is on the wire and the treatment is not on screen: nothing is written
    // optimistically, because a treatment the API has not accepted is not a clinical
    // record.
    expect(screen.queryByTestId('treatment-record')).toBeNull();
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/treatments`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, so the server is not asked to store what the boxes'
    // edges happen to hold.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      treatmentId: 'treatment-1',
      tooth: '16',
      notes: 'Composite on 16.',
    });

    release();

    // The invalidation refetched the list, and the server's row is what is on screen.
    expect(await screen.findByTestId('treatment-record')).toHaveTextContent('Composite filling');
    expect(screen.getByTestId('treatment-record')).toHaveTextContent('Tooth 16');

    // The form clears on success, and only there.
    expect(screen.getByTestId('treatment-tooth')).toHaveValue('');
    expect(screen.getByTestId('treatment-notes')).toHaveValue('');
    expect(screen.getByTestId('treatment-catalogue')).toHaveTextContent('Choose a treatment');

    // Recording a treatment changes nothing about the visit itself, so neither the
    // visit nor the patient's profile was refetched — invalidating `['visits']`
    // wholesale would have done both for pixels that cannot differ.
    const visitReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(visitReads).toHaveLength(1);
  });

  it('keeps the form the clinician filled and says why when the treatment is refused', async () => {
    const { fetchImplementation } = renderWorkspace({
      treatmentRefusal: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: '"99" is not a valid FDI tooth number',
            requestId: 'test',
          },
        },
      },
    });

    await user.click(await screen.findByTestId('visit-section-treatments'));
    await chooseFrom('treatment-catalogue', /Composite filling/);
    await user.type(screen.getByTestId('treatment-tooth'), '99');
    await user.click(screen.getByTestId('record-treatment'));

    // The refusal reaches the screen in the API's own words, and the selection is
    // still there: a network error that took the clinician's choice with it would be
    // the most destructive thing this panel does.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '"99" is not a valid FDI tooth number',
    );
    expect(screen.getByTestId('treatment-tooth')).toHaveValue('99');
    expect(fetchImplementation).toHaveBeenCalled();
    expect(screen.queryByTestId('treatment-record')).toBeNull();
  });

  it('lists the prescriptions on the visit, in the clinic’s clock, only once the section is open', async () => {
    const { fetchImplementation } = renderWorkspace({
      visitPrescriptions: [
        {
          id: 'prescription-1',
          visitId: VISIT_ID,
          patientId: PATIENT_ID,
          dentistId: 'dentist-1',
          issuedAt: '2026-10-05T14:00:00.000Z',
          medication: 'Ibuprofen',
          dosage: '400 mg',
          route: 'ORAL',
          frequency: 'Every 8 hours',
          durationDays: 5,
          instructions: 'Take after meals.',
        },
      ],
    });

    // The summary is what the workspace opens on, and the prescriptions were not
    // asked for: a request whose answer no pixel can show is a request waiting to
    // be stale.
    await screen.findByTestId('visit-workspace');
    expect(
      fetchImplementation.mock.calls.filter(([url]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/prescriptions`),
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('visit-section-prescriptions'));

    const row = await screen.findByTestId('prescription');
    expect(row).toHaveTextContent('Ibuprofen · 400 mg');
    expect(row).toHaveTextContent('Oral · Every 8 hours');
    expect(row).toHaveTextContent('· 5 days');
    expect(row).toHaveTextContent('Take after meals.');
    // 14:00Z is 09:00 in Lima — the clinic's hour again, on a prescription this time.
    expect(row).toHaveTextContent('09:00');
    expect(row).not.toHaveTextContent('14:00');
    expect(screen.queryByText('No prescriptions written yet.')).toBeNull();
  });

  it('says there are no prescriptions rather than showing an empty list as an error', async () => {
    renderWorkspace({ visitPrescriptions: [] });

    await user.click(await screen.findByTestId('visit-section-prescriptions'));

    expect(await screen.findByText('No prescriptions written yet.')).toBeTruthy();
    expect(screen.queryByTestId('prescription')).toBeNull();
  });

  it('files a prescription and shows it only once the server has answered', async () => {
    let release: () => void = () => {};
    const prescriptionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderWorkspace({
      visitPrescriptions: [],
      prescriptionGate,
    });

    await user.click(await screen.findByTestId('visit-section-prescriptions'));
    await screen.findByText('No prescriptions written yet.');

    await user.type(screen.getByTestId('prescription-medication'), '  Ibuprofen  ');
    await user.type(screen.getByTestId('prescription-dosage'), '400 mg');
    await chooseFrom('prescription-route', /Oral/);
    await user.type(screen.getByTestId('prescription-frequency'), 'Every 8 hours');
    await user.type(screen.getByTestId('prescription-duration'), '5');
    await user.type(screen.getByTestId('prescription-instructions'), ' Take after meals.  ');
    await user.click(screen.getByTestId('write-prescription'));

    // The POST is on the wire and the prescription is not on screen: nothing is
    // written optimistically, because a prescription the API has not accepted is not
    // a clinical record.
    expect(screen.queryByTestId('prescription')).toBeNull();
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/prescriptions`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, so the server is not asked to store what the boxes'
    // edges happen to hold.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      medication: 'Ibuprofen',
      dosage: '400 mg',
      route: 'ORAL',
      frequency: 'Every 8 hours',
      durationDays: 5,
      instructions: 'Take after meals.',
    });

    release();

    // The invalidation refetched the list, and the server's row is what is on screen.
    expect(await screen.findByTestId('prescription')).toHaveTextContent('Ibuprofen · 400 mg');
    expect(screen.getByTestId('prescription')).toHaveTextContent('· 5 days');

    // The form clears on success, and only there.
    expect(screen.getByTestId('prescription-medication')).toHaveValue('');
    expect(screen.getByTestId('prescription-dosage')).toHaveValue('');
    expect(screen.getByTestId('prescription-frequency')).toHaveValue('');
    // A number input reports empty through its value as a number, so the DOM value
    // '' appears to the matcher as null.
    expect(screen.getByTestId('prescription-duration')).toHaveValue(null);
    expect(screen.getByTestId('prescription-instructions')).toHaveValue('');
    expect(screen.getByTestId('prescription-route')).toHaveTextContent('Choose a route');

    // Writing a prescription changes nothing about the visit itself, so neither the
    // visit nor the patient's profile was refetched — invalidating `['visits']`
    // wholesale would have done both for pixels that cannot differ.
    const visitReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(visitReads).toHaveLength(1);
  });

  it('lists the charges on the visit, in the clinic’s clock, only once the section is open', async () => {
    const { fetchImplementation } = renderWorkspace({
      visitCharges: [
        {
          id: 'charge-1',
          clinicId: 'clinic-1',
          patientId: PATIENT_ID,
          visitId: VISIT_ID,
          invoiceId: null,
          invoicedAt: null,
          createdAt: '2026-10-05T14:00:00.000Z',
          treatmentId: null,
          description: 'Composite restoration',
          quantity: 1,
          unitPriceMinor: 8500,
          discountMinor: 0,
          taxRatePercent: 0,
          currency: 'USD',
        },
      ],
    });

    await screen.findByTestId('visit-workspace');
    expect(
      fetchImplementation.mock.calls.filter(([url]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/charges`),
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('visit-section-charges'));

    const row = await screen.findByTestId('charge');
    expect(row).toHaveTextContent('Composite restoration');
    expect(row).toHaveTextContent('85.00');
    expect(row).toHaveTextContent('09:00');
    expect(screen.queryByText('No charges raised yet.')).toBeNull();
  });

  it('says there are no charges rather than showing an empty list as an error', async () => {
    renderWorkspace({ visitCharges: [] });

    await user.click(await screen.findByTestId('visit-section-charges'));

    expect(await screen.findByText('No charges raised yet.')).toBeTruthy();
    expect(screen.queryByTestId('charge')).toBeNull();
  });

  it('raises a charge and shows it only once the server has answered', async () => {
    let release: () => void = () => {};
    const chargeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderWorkspace({ visitCharges: [], chargeGate });

    await user.click(await screen.findByTestId('visit-section-charges'));
    await screen.findByText('No charges raised yet.');

    await user.type(screen.getByTestId('charge-description'), '  Composite  ');
    await user.type(screen.getByTestId('charge-unit-price'), '85.00');
    await user.type(screen.getByTestId('charge-quantity'), '2');
    await user.click(screen.getByTestId('raise-charge'));

    expect(screen.queryByTestId('charge')).toBeNull();
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/charges`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      description: 'Composite',
      quantity: 2,
      unitPriceMinor: 8500,
    });

    release();

    expect(await screen.findByTestId('charge')).toHaveTextContent('Composite');
    expect(screen.getByTestId('charges-total')).toHaveTextContent('170.00');

    expect(screen.getByTestId('charge-description')).toHaveValue('');
    expect(screen.getByTestId('charge-unit-price')).toHaveValue('');
    expect(screen.getByTestId('charge-quantity')).toHaveValue(null);
    expect(screen.getByTestId('charge-discount')).toHaveValue('');

    const visitReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(visitReads).toHaveLength(1);
  });

  it('keeps what the clinician typed and says why when the charge is refused', async () => {
    const { fetchImplementation } = renderWorkspace({
      chargeRefusal: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A charge needs a description',
            requestId: 'test',
          },
        },
      },
    });

    await user.click(await screen.findByTestId('visit-section-charges'));
    await user.type(screen.getByTestId('charge-description'), 'Cleaning');
    await user.type(screen.getByTestId('charge-unit-price'), '85.00');
    await user.click(screen.getByTestId('raise-charge'));

    expect(await screen.findByRole('alert')).toHaveTextContent('A charge needs a description');
    expect(screen.getByTestId('charge-description')).toHaveValue('Cleaning');
    expect(fetchImplementation).toHaveBeenCalled();
    expect(screen.queryByTestId('charge')).toBeNull();
  });

  it('lists the payments on the visit, in the clinic’s clock, only once the section is open', async () => {
    const { fetchImplementation } = renderWorkspace({
      visitCharges: [
        {
          id: 'charge-1',
          clinicId: 'clinic-1',
          patientId: PATIENT_ID,
          visitId: VISIT_ID,
          invoiceId: 'invoice-1',
          invoicedAt: '2026-10-05T14:20:00.000Z',
          createdAt: '2026-10-05T14:00:00.000Z',
          treatmentId: null,
          description: 'Composite restoration',
          quantity: 1,
          unitPriceMinor: 8500,
          discountMinor: 0,
          taxRatePercent: 0,
          currency: 'USD',
        },
      ],
      visitPayments: [
        {
          id: 'payment-1',
          clinicId: 'clinic-1',
          patientId: PATIENT_ID,
          method: 'CARD',
          currency: 'USD',
          amountMinor: 8500,
          reference: '4242',
          receivedAt: '2026-10-05T14:00:00.000Z',
        },
      ],
    });

    // The summary is what the workspace opens on, and neither the bill nor the
    // register were asked for: a request whose answer no pixel can show is a
    // request waiting to be stale.
    await screen.findByTestId('visit-workspace');
    expect(
      fetchImplementation.mock.calls.filter(([url]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/payments`),
      ),
    ).toHaveLength(0);

    await user.click(screen.getByTestId('visit-section-payments'));

    const row = await screen.findByTestId('payment');
    expect(row).toHaveTextContent('Card');
    expect(row).toHaveTextContent('4242');
    expect(row).toHaveTextContent('85.00');
    // 14:00Z is 09:00 in Lima — the clinic's hour again, on a receipt this time.
    expect(row).toHaveTextContent('09:00');
    expect(screen.queryByText('No payments recorded yet.')).toBeNull();
    // The bill the register settles against is drawn beside it: the charges' total,
    // the payments' total, and the difference — the domain's own sums, not the
    // screen's.
    expect(screen.getByTestId('payments-billed')).toHaveTextContent('85.00');
    expect(screen.getByTestId('payments-paid')).toHaveTextContent('85.00');
    expect(screen.getByTestId('payments-still-to-pay')).toHaveTextContent('0.00');
    // Every charge is invoiced and the money covered the whole bill, so the door is
    // closed and the sentence says so — a "Record payment" button that always
    // answered 422 would be a control that looks live and is not.
    expect(await screen.findByText(/fully settled/)).toBeTruthy();
    expect(screen.queryByTestId('record-payment')).toBeNull();
  });

  it('says there are no payments rather than showing an empty list as an error', async () => {
    renderWorkspace({ visitCharges: [], visitPayments: [] });

    await user.click(await screen.findByTestId('visit-section-payments'));

    expect(await screen.findByText('No payments recorded yet.')).toBeTruthy();
    expect(screen.queryByTestId('payment')).toBeNull();
    // The door stays shut there too: nothing has been charged, so there is no bill
    // for a settlement to accept — the domain's "nothing left to pay", drawn before
    // the click instead of as the answer to it.
    expect(screen.getByText(/nothing has been charged/i)).toBeTruthy();
    expect(screen.queryByTestId('record-payment')).toBeNull();
  });

  it('records a payment and shows it only once the server has answered', async () => {
    let release: () => void = () => {};
    const paymentGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderWorkspace({
      visitCharges: [
        {
          id: 'charge-1',
          clinicId: 'clinic-1',
          patientId: PATIENT_ID,
          visitId: VISIT_ID,
          invoiceId: null,
          invoicedAt: null,
          createdAt: '2026-10-05T14:00:00.000Z',
          treatmentId: null,
          description: 'Composite restoration',
          quantity: 1,
          unitPriceMinor: 8500,
          discountMinor: 0,
          taxRatePercent: 0,
          currency: 'USD',
        },
      ],
      visitPayments: [],
      paymentGate,
    });

    await user.click(await screen.findByTestId('visit-section-payments'));
    await screen.findByText('No payments recorded yet.');

    await user.type(screen.getByTestId('payment-amount'), '50.00');
    await chooseFrom('payment-method', /Cash/);
    await user.type(screen.getByTestId('payment-reference'), '  1234  ');
    await user.click(screen.getByTestId('record-payment'));

    // The POST is on the wire and the payment is not on screen: nothing is written
    // optimistically, because money the API has not accepted is not a receipt.
    expect(screen.queryByTestId('payment')).toBeNull();
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}/payments`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    // Trimmed on the way out, so the server is not asked to store what the box's
    // edges happen to hold.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      method: 'CASH',
      amountMinor: 5000,
      reference: '1234',
    });

    release();

    // The invalidation refetched both registers, and the server's rows are on screen.
    expect(await screen.findByTestId('payment')).toHaveTextContent('Cash');
    expect(screen.getByTestId('payment')).toHaveTextContent('50.00');
    expect(screen.getByTestId('payments-paid')).toHaveTextContent('50.00');
    expect(screen.getByTestId('payments-still-to-pay')).toHaveTextContent('35.00');

    // The settlement stamped the whole bill invoiced, so the door closes with a
    // sentence that says where the remainder lives — the milestone's boundary, told
    // to the front desk instead of answered as a 422.
    expect(await screen.findByText(/The remaining 35\.00 is held on this visit/)).toBeTruthy();
    expect(screen.queryByTestId('record-payment')).toBeNull();

    // Recording a payment changes nothing about the visit itself, so neither the
    // visit nor the patient's profile was refetched — invalidating `['visits']`
    // wholesale would have done both for pixels that cannot differ.
    const visitReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/visits/${VISIT_ID}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(visitReads).toHaveLength(1);
    // The payments register was refetched for the new row, and the charges list
    // beside it, because the bill it draws is now stamped invoiced.
    const paymentsReads = fetchImplementation.mock.calls.filter(([url]) =>
      String(url).endsWith(`/visits/${VISIT_ID}/payments`),
    );
    expect(paymentsReads.length).toBeGreaterThanOrEqual(2);
    const chargesReads = fetchImplementation.mock.calls.filter(([url]) =>
      String(url).endsWith(`/visits/${VISIT_ID}/charges`),
    );
    expect(chargesReads.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps what the front desk typed and says why when the payment is refused', async () => {
    const { fetchImplementation } = renderWorkspace({
      visitCharges: [
        {
          id: 'charge-1',
          clinicId: 'clinic-1',
          patientId: PATIENT_ID,
          visitId: VISIT_ID,
          invoiceId: null,
          invoicedAt: null,
          createdAt: '2026-10-05T14:00:00.000Z',
          treatmentId: null,
          description: 'Composite restoration',
          quantity: 1,
          unitPriceMinor: 8500,
          discountMinor: 0,
          taxRatePercent: 0,
          currency: 'USD',
        },
      ],
      visitPayments: [],
      paymentRefusal: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The payment reference is too long',
            requestId: 'test',
          },
        },
      },
    });

    await user.click(await screen.findByTestId('visit-section-payments'));
    await user.type(screen.getByTestId('payment-amount'), '50.00');
    await chooseFrom('payment-method', /Cash/);
    await user.type(screen.getByTestId('payment-reference'), 'Too much text');
    await user.click(screen.getByTestId('record-payment'));

    // The refusal reaches the screen in the API's own words, and the draft is still
    // there: a network error that took the front desk's amount with it would be the
    // most destructive thing this panel does.
    expect(await screen.findByRole('alert')).toHaveTextContent('The payment reference is too long');
    expect(screen.getByTestId('payment-amount')).toHaveValue('50.00');
    expect(fetchImplementation).toHaveBeenCalled();
    expect(screen.queryByTestId('payment')).toBeNull();
  });
});
