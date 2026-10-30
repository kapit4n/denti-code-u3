import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { SettingsPage } from './settings-page.js';

const BASE_URL = 'http://api.test/api/v1';

const CLINIC = {
  id: 'clinic-1',
  name: 'Clinica Visible',
  legalName: 'Clinica Visible S.A.',
  taxId: '20123456789',
  address: 'Av. Siempre Viva 742',
  phone: '+51 999 111 222',
  email: 'hola@clinica.test',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [
    { weekday: 1, opensAtLocalTime: '08:00', closesAtLocalTime: '17:00', isClosed: false },
    { weekday: 2, opensAtLocalTime: '08:00', closesAtLocalTime: '17:00', isClosed: false },
    { weekday: 3, opensAtLocalTime: '08:00', closesAtLocalTime: '17:00', isClosed: false },
    { weekday: 4, opensAtLocalTime: '08:00', closesAtLocalTime: '17:00', isClosed: false },
    { weekday: 5, opensAtLocalTime: '08:00', closesAtLocalTime: '17:00', isClosed: false },
    { weekday: 6, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true },
    { weekday: 7, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true },
  ],
  settings: {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly saveRefusal?: { readonly status: number; readonly body: unknown };
}

function renderSettings({ saveRefusal }: HarnessOptions = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/api/v1/clinic' && method === 'GET') {
      return jsonResponse(CLINIC);
    }
    if (path === '/api/v1/clinic' && method === 'PUT') {
      if (saveRefusal) {
        return jsonResponse(saveRefusal.body, saveRefusal.status);
      }
      const written = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ ...CLINIC, ...written });
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
        <SettingsPage />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

function savedBody(fetchImplementation: ReturnType<typeof renderSettings>['fetchImplementation']) {
  const call = fetchImplementation.mock.calls.find(
    ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'PUT',
  );
  return call ? (JSON.parse(String(call[1]?.body)) as Record<string, unknown>) : undefined;
}

describe('SettingsPage', () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the clinic identity and all seven days', async () => {
    renderSettings();

    expect(await screen.findByDisplayValue('Clinica Visible')).toBeTruthy();
    expect(screen.getByDisplayValue('America/Lima')).toBeTruthy();
    expect(screen.getByDisplayValue('PEN')).toBeTruthy();
    expect(screen.getAllByTestId('settings-hours-row')).toHaveLength(7);
    expect(screen.getByTestId('settings-opens-0')).toHaveValue('08:00');
    expect(screen.getByTestId('settings-closed-5')).toBeChecked();
  });

  it('sends the whole record, with the currency uppercased and the closed day flagged', async () => {
    const { fetchImplementation } = renderSettings();
    await screen.findByDisplayValue('Clinica Visible');

    const name = screen.getByTestId('settings-name');
    await user.clear(name);
    await user.type(name, '  Clinica Nueva  ');

    const currency = screen.getByTestId('settings-currency');
    await user.clear(currency);
    await user.type(currency, 'usd');

    await user.click(screen.getByTestId('settings-closed-4'));
    await user.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(savedBody(fetchImplementation)).toBeDefined());

    const body = savedBody(fetchImplementation) as Record<string, unknown>;
    expect(body.name).toBe('Clinica Nueva');
    expect(body.currency).toBe('USD');
    expect(body.timeZone).toBe('America/Lima');
    expect(body.operatingHours).toHaveLength(7);
    expect(body.operatingHours).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ weekday: 5, isClosed: true }),
        expect.objectContaining({ weekday: 1, isClosed: false }),
      ]),
    );
    expect(await screen.findByText('Clinic settings saved.')).toBeTruthy();
  });

  it('keeps the draft and explains a forbidden save', async () => {
    renderSettings({
      saveRefusal: {
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN',
            message: 'No',
            details: {},
            requestId: 'r',
          },
        },
      },
    });
    await screen.findByDisplayValue('Clinica Visible');

    const name = screen.getByTestId('settings-name');
    await user.clear(name);
    await user.type(name, 'Clinica Nueva');
    await user.click(screen.getByTestId('settings-save'));

    expect(await screen.findByTestId('settings-failure')).toHaveTextContent(
      'Only an administrator can change clinic settings.',
    );
    expect(screen.getByTestId('settings-name')).toHaveValue('Clinica Nueva');
  });
});
