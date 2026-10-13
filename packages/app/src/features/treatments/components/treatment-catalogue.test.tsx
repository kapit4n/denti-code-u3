/**
 * Tests for the treatment catalogue page.
 *
 * What is being pinned down is the screen's honesty about four things it could
 * easily guess instead: that the price box is what the *server* stores as an
 * integer of cents, that a blank name never reaches the wire, that a treatment
 * appears only after a refetch has produced it, and that a refusal keeps the
 * draft. Each has a defect that renders plausibly — a row listed from the form's
 * own values, a `450.00` sent as `450`, a cleared form after a 409 — and none of
 * them throws, so nothing short of driving the screen catches them.
 *
 * The page is rendered with a real `ApiClient` and a stub `fetch` that routes by
 * method and path, so the requests are asserted as they go over the wire.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { TreatmentCatalogue } from './treatment-catalogue.js';

const BASE_URL = 'http://api.test/api/v1';

const EXISTING = {
  items: [
    {
      id: 'treatment-1',
      code: 'COMPO-ANT',
      name: 'Composite restoration — anterior',
      description: 'Restores a tooth’s shape and function.',
      defaultDurationMinutes: 45,
      defaultPriceMinor: 30_000,
      isActive: true,
    },
  ],
};

const CREATED = {
  id: 'treatment-2',
  code: 'ENDO-APICO',
  name: 'Apicoectomy',
  description: 'Surgical removal of a tooth root tip.',
  defaultDurationMinutes: 90,
  defaultPriceMinor: 75_000,
  isActive: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  /** What `GET /treatments` answers with when the page opens. */
  readonly catalogue?: { readonly items: readonly Record<string, unknown>[] };
  /** When set, filing a treatment is refused with this envelope. */
  readonly addRefusal?: { readonly status: number; readonly body: unknown };
  /**
   * A promise the *second* catalogue read waits on before it answers, so a test
   * can look at the screen while the refetch that should carry the new row is
   * still in flight.
   */
  readonly refetchGate?: Promise<void>;
}

function renderCatalogue({ catalogue = EXISTING, addRefusal, refetchGate }: HarnessOptions = {}) {
  const items = [...(catalogue.items as Record<string, unknown>[])];
  let reads = 0;

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/api/v1/treatments' && method === 'GET') {
      reads += 1;
      const answer = jsonResponse({ items });
      if (reads > 1 && refetchGate) {
        await refetchGate;
      }
      return answer;
    }
    if (path === '/api/v1/treatments' && method === 'POST') {
      if (addRefusal) {
        return jsonResponse(addRefusal.body, addRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const created = { ...CREATED, ...written, id: CREATED.id };
      items.push(created);
      return jsonResponse(created, 201);
    }
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
        <TreatmentCatalogue />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

/** The bodies actually POSTed, in order. */
function postedBodies(
  fetchImplementation: ReturnType<typeof renderCatalogue>['fetchImplementation'],
) {
  return fetchImplementation.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

async function fillValidForm(user: UserEvent) {
  await user.type(screen.getByTestId('treatment-name'), 'Apicoectomy');
  await user.type(screen.getByTestId('treatment-code'), 'ENDO-APICO');
  await user.type(screen.getByTestId('treatment-price'), '750.00');
  await user.type(screen.getByTestId('treatment-duration'), '90');
}

describe('TreatmentCatalogue', () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws the catalogue’s rows, with the price as money rather than cents', async () => {
    renderCatalogue();

    const row = await screen.findByTestId('treatment-catalogue-item');
    expect(row).toHaveTextContent('Composite restoration — anterior');
    expect(row).toHaveTextContent('COMPO-ANT');
    expect(row).toHaveTextContent('45 min');
    // 30000 minor units is 300.00, never "30000".
    expect(row).toHaveTextContent('300.00');
    expect(row).not.toHaveTextContent('30000');
    expect(screen.getByText('1 treatment offered')).toBeTruthy();
  });

  it('shows the empty sentence when the clinic offers nothing yet', async () => {
    renderCatalogue({ catalogue: { items: [] } });

    expect(await screen.findByText('No treatments in the catalogue yet.')).toBeTruthy();
  });

  it('refuses a nameless treatment at the boundary, and sends nothing', async () => {
    const { fetchImplementation } = renderCatalogue();

    await screen.findByTestId('treatment-catalogue-item');
    await user.type(screen.getByTestId('treatment-code'), 'NO-NAME');
    await user.click(screen.getByTestId('add-treatment'));

    expect(await screen.findByText('A treatment needs a name')).toBeTruthy();
    expect(postedBodies(fetchImplementation)).toHaveLength(0);
  });

  it('files the treatment with the price parsed to cents, and lists it only once the server has answered', async () => {
    let release: () => void = () => {};
    const refetchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImplementation } = renderCatalogue({ refetchGate });

    await screen.findByTestId('treatment-catalogue-item');
    await fillValidForm(user);
    await user.click(screen.getByTestId('add-treatment'));

    // The POST is on the wire; the refetch that would carry the row has not
    // answered, so nothing may be listed from the form's own values.
    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));
    const [body] = postedBodies(fetchImplementation);
    // The whole body, spelled out: the price crossed as the integer of cents it
    // was parsed to, and the description nobody typed as `null` rather than `''`.
    expect(body).toEqual({
      code: 'ENDO-APICO',
      name: 'Apicoectomy',
      description: null,
      defaultDurationMinutes: 90,
      defaultPriceMinor: 75_000,
    });
    // Still one row: the new one is the refetch's to produce, not the form's.
    expect(screen.getAllByTestId('treatment-catalogue-item')).toHaveLength(1);

    release();

    // `findAllByTestId` resolves as soon as *one* row matches, so the count is
    // asserted inside a wait rather than taken at the first glance.
    await waitFor(() => expect(screen.getAllByTestId('treatment-catalogue-item')).toHaveLength(2));
    const rows = screen.getAllByTestId('treatment-catalogue-item');
    expect(rows.some((row) => row.textContent?.includes('Apicoectomy'))).toBe(true);
    // The draft is cleared only now — the API took it.
    expect(screen.getByTestId('treatment-name')).toHaveValue('');
  });

  it('keeps the whole draft when the API refuses the treatment', async () => {
    renderCatalogue({
      addRefusal: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'That code is already in the catalogue',
            requestId: 't',
          },
        },
      },
    });

    await screen.findByTestId('treatment-catalogue-item');
    await fillValidForm(user);
    await user.click(screen.getByTestId('add-treatment'));

    expect(await screen.findByText('That code is already in the catalogue')).toBeTruthy();
    expect(screen.getByTestId('treatment-name')).toHaveValue('Apicoectomy');
    expect(screen.getByTestId('treatment-code')).toHaveValue('ENDO-APICO');
    expect(screen.getByTestId('treatment-price')).toHaveValue(750);
    // And the catalogue still holds only what the server had already agreed to.
    expect(await screen.findAllByTestId('treatment-catalogue-item')).toHaveLength(1);
  });
});
