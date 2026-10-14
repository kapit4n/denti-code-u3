/**
 * Tests for the patient's treatment-plans section.
 *
 * What is being pinned down is the screen's honesty about three things it could
 * easily guess instead: that the progress it draws is the *server's* projection
 * rather than a count it did for itself, that a plan is shown as what the API
 * returned rather than as what the profile already had on screen, and that an
 * empty list and a failed read are different sentences. None of them throws when
 * they are wrong, so nothing short of rendering the section catches them.
 *
 * The two writes are driven the same way: the harness answers the POST, mutates
 * its own list, and the section is checked to have redrawn from the *refetched*
 * list rather than to have edited itself — which is the whole point of not writing
 * optimistically. The create flow also pins the body it sends, because the item
 * rows are composed on the client and a dropped price or a stray blank line would
 * only show up on the wire.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { formatClinicDay } from '../../clinic/format-clinic-time.js';
import { PatientTreatmentPlansSection } from './patient-treatment-plans-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const PLANS_PATH = `/api/v1/patients/${PATIENT_ID}/treatment-plans`;
const TREATMENTS_PATH = '/api/v1/treatments';

const TREATMENT = {
  id: 'treatment-1',
  code: 'COMPO-ANT',
  name: 'Composite restoration — anterior',
  description: null,
  defaultDurationMinutes: 30,
  defaultPriceMinor: 25_000,
  isActive: true,
};

const PLAN = {
  id: 'plan-1',
  dentistId: null,
  status: 'ACCEPTED',
  title: 'Restorative plan',
  notes: null,
  presentedAt: '2026-10-05T02:00:00.000Z',
  acceptedAt: '2026-10-05T02:05:00.000Z',
  updatedAt: '2026-10-05T02:05:00.000Z',
  items: [
    {
      id: 'item-1',
      treatmentId: 'treatment-1',
      treatmentCode: 'COMPO-ANT',
      treatmentName: 'Composite restoration — anterior',
      tooth: '26',
      surfaces: [],
      quantity: 1,
      estimatedPriceMinor: 30_000,
      isCompleted: true,
      completedAt: '2026-10-05T13:30:00.000Z',
      notes: null,
    },
    {
      id: 'item-2',
      treatmentId: 'treatment-2',
      treatmentCode: null,
      treatmentName: 'Scaling and prophylaxis',
      tooth: '36',
      surfaces: [],
      quantity: 2,
      estimatedPriceMinor: 0,
      isCompleted: false,
      completedAt: null,
      notes: null,
    },
  ],
  // The server's projection, not this fixture's arithmetic.
  progress: { total: 2, completed: 1, inProgress: 0, pending: 1, percentComplete: 50 },
};

const CREATED_PLAN = {
  id: 'plan-new',
  dentistId: null,
  status: 'DRAFT',
  title: null,
  notes: null,
  presentedAt: null,
  acceptedAt: null,
  updatedAt: '2026-10-07T10:00:00.000Z',
  items: [
    {
      id: 'item-new',
      treatmentId: 'treatment-1',
      treatmentCode: 'COMPO-ANT',
      treatmentName: 'Composite restoration — anterior',
      tooth: '36',
      surfaces: [],
      quantity: 1,
      estimatedPriceMinor: 12_050,
      isCompleted: false,
      completedAt: null,
      notes: null,
    },
  ],
  progress: { total: 1, completed: 0, inProgress: 0, pending: 1, percentComplete: 0 },
};

interface ObservedCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly plans?: { readonly items: readonly Record<string, unknown>[] };
  readonly readFailure?: { readonly status: number; readonly body: unknown };
  readonly createFailure?: { readonly status: number; readonly body: unknown };
  readonly completeFailure?: { readonly status: number; readonly body: unknown };
}

function renderSection(options: HarnessOptions = {}) {
  // `plans` is mutated by the writes the way a real server would, so a refetch
  // after a POST is what makes the new or changed row appear.
  let plans = options.plans ?? { items: [PLAN] };
  const calls: ObservedCall[] = [];

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === TREATMENTS_PATH && method === 'GET') {
      return jsonResponse({ items: [TREATMENT] });
    }

    if (url.pathname === PLANS_PATH && method === 'GET') {
      if (options.readFailure) {
        return jsonResponse(options.readFailure.body, options.readFailure.status);
      }
      return jsonResponse(plans);
    }

    if (url.pathname === PLANS_PATH && method === 'POST') {
      if (options.createFailure) {
        return jsonResponse(options.createFailure.body, options.createFailure.status);
      }
      plans = { items: [CREATED_PLAN, ...plans.items] };
      return jsonResponse({ plan: CREATED_PLAN }, 201);
    }

    const completePrefix = `${PLANS_PATH}/`;
    if (method === 'POST' && url.pathname.startsWith(completePrefix)) {
      if (options.completeFailure) {
        return jsonResponse(options.completeFailure.body, options.completeFailure.status);
      }
      const [planId, , itemId] = url.pathname.slice(completePrefix.length).split('/');
      plans = {
        items: plans.items.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                items: (plan.items as Record<string, unknown>[]).map((item) =>
                  item.id === itemId ? { ...item, isCompleted: true } : item,
                ),
              }
            : plan,
        ),
      };
      return new Response(null, { status: 204 });
    }

    return jsonResponse(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: `Unexpected ${method} ${url.pathname}`,
          requestId: 't',
        },
      },
      501,
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <PatientTreatmentPlansSection patientId={PATIENT_ID} clinicTimeZone="America/Lima" />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, calls };
}

describe('PatientTreatmentPlansSection', () => {
  /**
   * Radix sets `body { pointer-events: none }` while one of its dropdowns is open,
   * and user-event honours it — refusing to click anything afterwards. jsdom never
   * runs the close animation that takes the attribute back off, and it implements
   * neither the positioning APIs the content uses nor `scrollIntoView`. The same
   * stubs the visit workspace's tests carry, for the same Radix select.
   */
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup({ pointerEventsCheck: 0 });

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
    vi.stubGlobal('scrollTo', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** Picks an option from a Radix select. */
  async function chooseFrom(triggerTestId: string, optionName: RegExp): Promise<void> {
    await user.click(screen.getByTestId(triggerTestId));
    await user.click(await screen.findByRole('option', { name: optionName }));
  }

  it('draws the plan, its progress, and its items', async () => {
    renderSection();

    const plan = await screen.findByTestId('patient-treatment-plan');
    expect(plan).toHaveTextContent('Restorative plan');
    expect(plan).toHaveTextContent('ACCEPTED');

    // The progress is the server's: 1 of 2, 50%.
    expect(screen.getByTestId('plan-progress')).toHaveTextContent('2 items · 1 complete · 50%');

    const items = screen.getAllByTestId('patient-treatment-plan-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Tooth 26 · Composite restoration — anterior');
    expect(items[0]).toHaveTextContent('300.00');
    expect(items[1]).toHaveTextContent('Tooth 36 · Scaling and prophylaxis');
    expect(items[1]).toHaveTextContent('× 2');
    expect(items[1]).toHaveTextContent('0.00');
  });

  it('reads the presented day on the clinic’s clock, not the browser’s', async () => {
    renderSection();

    const plan = await screen.findByTestId('patient-treatment-plan');
    // 02:00Z on the 5th is still the 4th in Lima. Drawing it in UTC — or in the
    // machine's own zone — would name the 5th, and the fixture is built so the
    // two differ.
    const inLima = formatClinicDay(PLAN.presentedAt, 'America/Lima');
    expect(plan).toHaveTextContent(`Presented ${inLima}`);
    expect(plan).not.toHaveTextContent(PLAN.presentedAt);
  });

  it('shows the empty sentence for a patient nothing has been offered', async () => {
    renderSection({ plans: { items: [] } });

    expect(await screen.findByText('No treatment plans for this patient yet.')).toBeTruthy();
  });

  it('says the read failed rather than showing an empty list', async () => {
    renderSection({
      readFailure: {
        status: 501,
        body: { error: { code: 'INTERNAL_ERROR', message: 'no fixture', requestId: 't' } },
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The treatment plans could not be loaded.');
    expect(screen.queryByText('No treatment plans for this patient yet.')).toBeNull();
  });

  it('does not claim a patient this clinic holds has no plans while the read is in flight', async () => {
    renderSection();

    // The loading sentence is the honest one; the empty sentence would be a
    // claim about the patient that has not been checked yet.
    expect(screen.getByText('Loading the plans…')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('patient-treatment-plan')).toBeTruthy());
  });

  it('proposes a plan, sends the composed body, and redraws from the refetched list', async () => {
    const { calls } = renderSection({ plans: { items: [] } });

    await user.click(await screen.findByTestId('new-plan-open'));
    await chooseFrom('new-plan-treatment', /COMPO-ANT/);
    await user.type(screen.getByTestId('new-plan-tooth'), '36');
    await user.type(screen.getByTestId('new-plan-price'), '120.50');
    await user.click(screen.getByTestId('new-plan-submit'));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.path === PLANS_PATH)).toBe(true);
    });
    const post = calls.find((call) => call.method === 'POST' && call.path === PLANS_PATH);
    // A blank quantity is dropped rather than sent as an empty string, and the
    // price the box held ("120.50") travels as the minor units the boundary wants.
    expect(post?.body).toEqual({
      items: [{ treatmentId: 'treatment-1', tooth: '36', estimatedPriceMinor: 12_050 }],
    });

    // The new plan appears because the list was refetched, and the form closes
    // only after the server has answered.
    const plan = await screen.findByTestId('patient-treatment-plan');
    expect(plan).toHaveTextContent('DRAFT');
    expect(screen.getByTestId('plan-progress')).toHaveTextContent('1 item · 0 complete · 0%');
    await waitFor(() => expect(screen.queryByTestId('new-treatment-plan-form')).toBeNull());
  });

  it('keeps the draft and quotes the server when a plan is refused', async () => {
    renderSection({
      plans: { items: [] },
      createFailure: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A treatment plan needs at least one item',
            requestId: 't',
          },
        },
      },
    });

    await user.click(await screen.findByTestId('new-plan-open'));
    await chooseFrom('new-plan-treatment', /COMPO-ANT/);
    await user.click(screen.getByTestId('new-plan-submit'));

    const alert = await screen.findByTestId('new-plan-error');
    expect(alert).toHaveTextContent('A treatment plan needs at least one item');
    // The form is still open — a refused write leaves what was typed where it was.
    expect(screen.getByTestId('new-treatment-plan-form')).toBeTruthy();
  });

  it('marks an item done through a bodyless POST and redraws from the refetched list', async () => {
    const { calls } = renderSection();

    // Only the incomplete item offers the control.
    const button = await screen.findByTestId('complete-plan-item');
    await user.click(button);

    const path = `${PLANS_PATH}/plan-1/items/item-2/complete`;
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.path === path)).toBe(true);
    });
    const post = calls.find((call) => call.method === 'POST' && call.path === path);
    // Bodyless: a body the endpoint never reads would let a client believe a field
    // was accepted.
    expect(post?.body).toBeUndefined();

    // The refetched list shows the item done, so no control remains.
    await waitFor(() => expect(screen.queryByTestId('complete-plan-item')).toBeNull());
  });

  it('says the item is gone rather than blaming the network when the write 404s', async () => {
    renderSection({
      completeFailure: {
        status: 404,
        body: {
          error: { code: 'NOT_FOUND', message: 'Plan not found', requestId: 't' },
        },
      },
    });

    await user.click(await screen.findByTestId('complete-plan-item'));

    const alert = await screen.findByTestId('complete-plan-item-error');
    expect(alert).toHaveTextContent('That treatment plan item is no longer on this patient.');
  });
});
