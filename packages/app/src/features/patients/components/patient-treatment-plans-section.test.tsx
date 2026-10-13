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
 * The section is read-only on purpose — there is no write to drive here — so the
 * harness is one route and a stub `fetch`.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { formatClinicDay } from '../../clinic/format-clinic-time.js';
import { PatientTreatmentPlansSection } from './patient-treatment-plans-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const PLANS_PATH = `/api/v1/patients/${PATIENT_ID}/treatment-plans`;

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly plans?: { readonly items: readonly Record<string, unknown>[] };
  readonly failure?: { readonly status: number; readonly body: unknown };
}

function renderSection({ plans = { items: [PLAN] }, failure }: HarnessOptions = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.pathname === PLANS_PATH && method === 'GET') {
      if (failure) {
        return jsonResponse(failure.body, failure.status);
      }
      return jsonResponse(plans);
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

  return { fetchImplementation };
}

describe('PatientTreatmentPlansSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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
      failure: {
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
});
