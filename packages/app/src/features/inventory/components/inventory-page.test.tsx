/**
 * The inventory page.
 *
 * These tests pin the screen's honesty about things that would otherwise render
 * plausibly: that low stock is the domain's comparison of the row's own columns,
 * that a cost crosses the wire as integer minor units rather than as typed, that
 * an item is added only after the server answers, and that recording usage sends
 * the movement the form describes and redraws the server's new level.
 *
 * The page is rendered with a real `ApiClient` and a stub `fetch` that routes by
 * method and path, so the bodies are asserted as they go over the wire.
 */
import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { InventoryPage } from './inventory-page.js';

const BASE_URL = 'http://api.test/api/v1';

const CLINIC = {
  id: 'clinic-1',
  name: 'Clinica Visible',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [],
  settings: {},
};

const RESIN = {
  id: 'item-1',
  clinicId: 'clinic-1',
  name: 'Composite resin A2',
  sku: 'COMP-A2',
  description: 'Syringe, shade A2',
  unit: 'syringe',
  stock: 2,
  minStock: 3,
  costMinor: 4_500,
  isActive: true,
};

const GAUZE = {
  ...RESIN,
  id: 'item-2',
  name: 'Gauze',
  sku: 'GAUZE',
  description: null,
  unit: 'pack',
  stock: 40,
  minStock: 10,
  costMinor: 800,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly items?: readonly Record<string, unknown>[];
  readonly movements?: Record<string, readonly Record<string, unknown>[]>;
  readonly movementRefusal?: { readonly status: number; readonly body: unknown };
}

function renderInventory({
  items: initialItems = [RESIN, GAUZE],
  movements: initialMovements = {
    [RESIN.id]: [
      {
        id: 'movement-0',
        itemId: RESIN.id,
        type: 'ADJUSTMENT',
        quantity: 12,
        unitCostMinor: 4_500,
        reference: 'Opening stock',
        notes: null,
        performedAt: '2026-10-22T14:30:00.000Z',
      },
    ],
  },
  movementRefusal,
}: HarnessOptions = {}) {
  const items = initialItems.map((item) => ({ ...item }));
  const movements = Object.fromEntries(
    Object.entries(initialMovements).map(([itemId, rows]) => [
      itemId,
      rows.map((row) => ({ ...row })),
    ]),
  ) as Record<string, Record<string, unknown>[]>;

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/api/v1/clinic' && method === 'GET') {
      return jsonResponse(CLINIC);
    }
    if (path === '/api/v1/inventory/items' && method === 'GET') {
      return jsonResponse({ items });
    }
    if (path === '/api/v1/inventory/items' && method === 'POST') {
      const written = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const item = {
        id: 'item-3',
        clinicId: 'clinic-1',
        isActive: true,
        unit: 'unit',
        stock: 0,
        minStock: 0,
        costMinor: 0,
        sku: null,
        description: null,
        ...written,
      };
      items.push(item);
      movements[String(item.id)] = [];
      return jsonResponse({ item }, 201);
    }

    const movementMatch = path.match(/^\/api\/v1\/inventory\/items\/([^/]+)\/movements$/);
    if (movementMatch && method === 'GET') {
      return jsonResponse({ items: movements[decodeURIComponent(movementMatch[1]!)] ?? [] });
    }
    if (movementMatch && method === 'POST') {
      if (movementRefusal) {
        return jsonResponse(movementRefusal.body, movementRefusal.status);
      }
      const itemId = decodeURIComponent(movementMatch[1]!);
      const written = JSON.parse(String(init?.body)) as {
        type: string;
        quantity: number;
        reference?: string | null;
      };
      const item = items.find((candidate) => candidate.id === itemId)!;
      const outflow = written.type === 'USAGE' || written.type === 'EXPIRED';
      item.stock = Number(item.stock) + (outflow ? -written.quantity : written.quantity);
      const movement = {
        id: `movement-${(movements[itemId]?.length ?? 0) + 1}`,
        itemId,
        type: written.type,
        quantity: written.quantity,
        unitCostMinor: null,
        reference: written.reference ?? null,
        notes: null,
        performedAt: '2026-10-22T15:00:00.000Z',
      };
      movements[itemId] = [...(movements[itemId] ?? []), movement];
      return jsonResponse({ item, movement }, 201);
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
        <InventoryPage />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

function postedBodies(
  fetchImplementation: ReturnType<typeof renderInventory>['fetchImplementation'],
): Record<string, unknown>[] {
  return fetchImplementation.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

describe('InventoryPage', () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws the stock, the low-stock card and costs as money', async () => {
    renderInventory();

    const rows = await screen.findAllByTestId('inventory-item');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Gauze');
    expect(rows[1]).toHaveTextContent('40 pack');
    expect(rows[1]).toHaveTextContent('8.00 each');
    expect(rows[1]).not.toHaveTextContent('800');

    expect(screen.getByTestId('inventory-low-stock')).toHaveTextContent('1 item at or below');
    expect(screen.getAllByTestId('low-stock-item')).toHaveLength(1);
    expect(screen.getAllByTestId('low-stock-badge')).toHaveLength(1);
  });

  it('shows the empty sentence when the clinic keeps nothing yet', async () => {
    renderInventory({ items: [], movements: {} });

    expect(await screen.findByTestId('inventory-empty')).toHaveTextContent(
      'No items in the inventory yet.',
    );
    expect(screen.queryByTestId('low-stock-item')).toBeNull();
  });

  it('adds an item with its cost as minor units and lists it after the server answers', async () => {
    const { fetchImplementation } = renderInventory();

    await screen.findAllByTestId('inventory-item');
    await user.type(screen.getByTestId('inventory-name'), 'Lidocaine 2%');
    await user.type(screen.getByTestId('inventory-sku'), 'LIDO-2');
    await user.type(screen.getByTestId('inventory-unit'), 'box');
    await user.type(screen.getByTestId('inventory-opening-stock'), '12');
    await user.type(screen.getByTestId('inventory-min-stock'), '4');
    await user.type(screen.getByTestId('inventory-cost'), '80.00');
    await user.click(screen.getByTestId('add-inventory-item'));

    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));
    expect(postedBodies(fetchImplementation)[0]).toEqual({
      name: 'Lidocaine 2%',
      sku: 'LIDO-2',
      description: null,
      unit: 'box',
      openingStock: 12,
      minStock: 4,
      costMinor: 8_000,
    });
    const names = await screen.findAllByText('Lidocaine 2%');
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('records usage and redraws the level the server answers with', async () => {
    const { fetchImplementation } = renderInventory();

    await screen.findAllByTestId('inventory-item');
    await user.selectOptions(screen.getByTestId('movement-item'), RESIN.id);
    await user.selectOptions(screen.getByTestId('movement-type'), 'USAGE');
    await user.type(screen.getByTestId('movement-quantity'), '1');
    await user.type(screen.getByTestId('movement-reference'), 'Visit 42');
    await user.click(screen.getByTestId('record-movement'));

    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));
    expect(postedBodies(fetchImplementation)[0]).toEqual({
      type: 'USAGE',
      quantity: 1,
      reference: 'Visit 42',
    });

    await waitFor(() =>
      expect(screen.getAllByTestId('inventory-item')[0]).toHaveTextContent('1 syringe'),
    );
    const movements = await screen.findAllByTestId('stock-movement');
    expect(movements[0]).toHaveTextContent('Opening stock');
    const quantities = screen.getAllByTestId('stock-movement-quantity');
    expect(quantities.at(-1)).toHaveTextContent('−1 syringe');
  });

  it('keeps the movement draft and quotes the refusal when stock is short', async () => {
    renderInventory({
      movementRefusal: {
        status: 409,
        body: {
          error: {
            code: 'DOMAIN_RULE_VIOLATION',
            message: 'Not enough stock for Composite resin A2',
            requestId: 't',
          },
        },
      },
    });

    await screen.findAllByTestId('inventory-item');
    await user.selectOptions(screen.getByTestId('movement-item'), RESIN.id);
    await user.selectOptions(screen.getByTestId('movement-type'), 'USAGE');
    await user.type(screen.getByTestId('movement-quantity'), '9');
    await user.click(screen.getByTestId('record-movement'));

    expect(await screen.findByText('Not enough stock for Composite resin A2')).toBeTruthy();
    expect(screen.getByTestId('movement-quantity')).toHaveValue(9);
    expect(screen.getAllByTestId('inventory-item')[0]).toHaveTextContent('2 syringe');
  });
});
