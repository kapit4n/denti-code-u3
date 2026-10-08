/**
 * Tests for the patient odontogram section.
 *
 * What is being pinned down is the screen's honesty about three things it could
 * easily guess instead: the chart's tooth as the only door into charting, the
 * server's row as the only truth about the chart, and a refusal that keeps the
 * clinician's draft. Each has a defect that renders plausibly — a tooth typed
 * next to a map that ignores it, a tooth that appears before the server agrees,
 * a sentence the front desk loses when the wire refuses — and none of
 * them throws, so nothing short of rendering the page catches them.
 *
 * The section is rendered with a real `ApiClient` and a stub `fetch` that routes
 * by method and path, so the requests are asserted as they go over the wire: a
 * screen that shows a charted tooth without posting, or posts a body the endpoint
 * never reads, is the failure this is here to catch.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientOdontogramSection } from './patient-odontogram-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';

const CHART = {
  entries: [
    {
      id: 'entry-16',
      patientId: PATIENT_ID,
      visitId: null,
      dentition: 'PERMANENT',
      tooth: '16',
      surfaces: ['MESIAL'],
      condition: 'CARIES',
      notes: 'Composite patch scheduled.',
      recordedAt: '2026-10-05T14:35:00.000Z',
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
  /** The chart the API answers with when the section opens. */
  readonly odontogram?: Record<string, unknown>;
  /** When set, charting a tooth is refused with this envelope. */
  readonly entryRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the entry POST waits on before it answers, so a test can look at the
   * screen while the request is still in flight.
   */
  readonly entryGate?: Promise<void>;
}

function renderSection({ odontogram = CHART, entryRefusal, entryGate }: HarnessOptions = {}) {
  const entries = [...(odontogram.entries as Record<string, unknown>[])];

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === `/api/v1/patients/${PATIENT_ID}/odontogram` && method === 'GET') {
      return jsonResponse({ entries });
    }
    if (path === `/api/v1/patients/${PATIENT_ID}/odontogram/entries` && method === 'POST') {
      if (entryRefusal) {
        return jsonResponse(entryRefusal.body, entryRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as {
        tooth: string;
        condition: string;
        surfaces: string[];
        notes?: string;
      };
      const recorded = {
        id: `entry-${entries.length + 1}`,
        patientId: PATIENT_ID,
        visitId: null,
        dentition: 'PERMANENT',
        tooth: written.tooth,
        surfaces: written.surfaces,
        condition: written.condition,
        notes: written.notes ?? null,
        recordedAt: '2026-10-05T14:40:00.000Z',
      };
      entries.push(recorded);
      // The answer waits on the gate: the request has been made, and the screen has
      // not been told about it yet.
      await entryGate;
      return jsonResponse(recorded, 201);
    }
    // Loud rather than a network error: a request this harness did not expect is a
    // defect in the test or in the component.
    return jsonResponse(
      {
        error: { code: 'INTERNAL_ERROR', message: `Unexpected ${method} ${path}`, requestId: 't' },
      },
      501,
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <PatientOdontogramSection patientId={PATIENT_ID} clinicTimeZone="America/Lima" />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

describe('PatientOdontogramSection', () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws the chart and the charted tooth’s finding', async () => {
    renderSection();

    // The seeded tooth wears its condition on the map.
    const tooth16 = await screen.findByTestId('odontogram-tooth-16');
    expect(tooth16).toHaveAttribute('data-condition', 'CARIES');
    expect(screen.getByTestId('odontogram-tooth-36')).toHaveAttribute(
      'data-condition',
      'UNCHARTED',
    );

    // The entry is listed beneath the chart with the clinic's hour: 14:35Z is
    // 09:35 in Lima.
    const entry = screen.getByTestId('odontogram-entry');
    expect(entry).toHaveTextContent('Tooth 16');
    expect(entry).toHaveTextContent('CARIES');
    expect(entry).toHaveTextContent('MESIAL');
    expect(entry).toHaveTextContent('Composite patch scheduled.');
    expect(entry).toHaveTextContent('09:35');
    expect(entry).not.toHaveTextContent('14:35');
    expect(screen.queryByText('No teeth charted yet.')).toBeNull();
  });

  it('shows the empty sentence for a patient whose teeth were never charted', async () => {
    renderSection({ odontogram: { entries: [] } });

    expect(await screen.findByText('No teeth charted yet.')).toBeTruthy();
  });

  it('keeps the write disabled until a tooth is chosen on the map', async () => {
    renderSection();

    await screen.findByTestId('odontogram-chart');

    expect(screen.getByTestId('record-odontogram-entry')).toBeDisabled();
    expect(screen.getByTestId('record-odontogram-entry')).toHaveTextContent(
      'Select a tooth to chart',
    );

    await user.click(screen.getByTestId('odontogram-tooth-36'));

    expect(screen.getByTestId('record-odontogram-entry')).toBeEnabled();
    expect(screen.getByTestId('record-odontogram-entry')).toHaveTextContent('Chart tooth 36');
  });

  it('charts the chosen tooth and shows the charted state only once the server has answered', async () => {
    let release: () => void = () => {};
    const entryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderSection({ entryGate });

    await screen.findByTestId('odontogram-chart');
    await user.click(screen.getByTestId('odontogram-tooth-16'));
    await user.selectOptions(screen.getByTestId('odontogram-condition'), 'CARIES');
    await user.click(screen.getByTestId('odontogram-surface-MESIAL'));
    await user.click(screen.getByTestId('odontogram-surface-OCCLUSAL'));
    await user.type(screen.getByTestId('odontogram-notes'), 'Composite patch scheduled.');
    await user.click(screen.getByTestId('record-odontogram-entry'));

    // The POST is on the wire and the chart has not gained a tooth: nothing is
    // written optimistically, because a tooth the API has not accepted is not a
    // clinical record.
    expect(screen.getAllByTestId('odontogram-entry')).toHaveLength(1);
    const post = fetchImplementation.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/patients/${PATIENT_ID}/odontogram/entries`) &&
        (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(post).toBeTruthy();
    // The finding travels whole and trimmed, and the empty optional fields do not
    // travel at all.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      tooth: '16',
      condition: 'CARIES',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      notes: 'Composite patch scheduled.',
    });

    release();

    // The invalidation refetched the chart, and the server's row is what appears.
    await waitFor(() => expect(screen.getAllByTestId('odontogram-entry')).toHaveLength(2));
    // The draft is cleared on success, and only there.
    expect(screen.getByTestId('odontogram-notes')).toHaveValue('');
  });

  it('keeps the draft and says why when the charting is refused', async () => {
    const { fetchImplementation } = renderSection({
      entryRefusal: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A finding must affect at least one surface',
            requestId: 'test',
          },
        },
      },
    });

    await screen.findByTestId('odontogram-chart');
    await user.click(screen.getByTestId('odontogram-tooth-36'));
    await user.selectOptions(screen.getByTestId('odontogram-condition'), 'CARIES');
    await user.type(screen.getByTestId('odontogram-notes'), 'Half a finding');
    await user.click(screen.getByTestId('record-odontogram-entry'));

    // The refusal reaches the screen in the API's own words, and the draft is
    // still there: a network error that took the clinician's sentence with it
    // would be the most destructive thing this panel does.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A finding must affect at least one surface',
    );
    expect(screen.getByTestId('odontogram-notes')).toHaveValue('Half a finding');
    expect(fetchImplementation).toHaveBeenCalled();
    expect(screen.getAllByTestId('odontogram-entry')).toHaveLength(1);
  });

  it('refetched the chart and nothing else when a tooth is charted', async () => {
    const { fetchImplementation } = renderSection();

    await screen.findByTestId('odontogram-chart');
    await user.click(screen.getByTestId('odontogram-tooth-16'));
    await user.click(screen.getByTestId('record-odontogram-entry'));
    await waitFor(() => expect(screen.getAllByTestId('odontogram-entry')).toHaveLength(2));

    // Charting changes the chart and nothing else, so invalidating the patient
    // wholesale would have refetched the profile for pixels that cannot differ.
    const odontogramReads = fetchImplementation.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/patients/${PATIENT_ID}/odontogram`) &&
        (init?.method ?? 'GET').toUpperCase() === 'GET',
    );
    expect(odontogramReads).toHaveLength(2);
  });
});
