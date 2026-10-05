/**
 * Tests for the clinic settings query.
 *
 * The agenda's timezone and opening hours come from here, so the endpoint under test
 * is `/clinic` and nothing else. A build-time constant would be the wrong answer —
 * one API serves every clinic — and this test is what stops that creeping back in.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import type { Clinic } from '@denti-code-u3/domain';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { useClinicSettings } from './clinic-settings-query.js';

const BASE_URL = 'http://api.test/api/v1';

const CLINIC: Clinic = {
  id: 'clinic-1',
  name: 'Clínica Dental U3',
  legalName: 'Denti-Code U3 S.A.C.',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [
    { weekday: 1, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
  ],
  settings: {},
};

function renderSettings(reply: () => Promise<Response>) {
  const seen: (Clinic | undefined)[] = [];
  const fetchImplementation = vi.fn<typeof fetch>(reply);
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });

  function Probe(): ReactNode {
    seen.push(useClinicSettings().data);
    return null;
  }

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <Probe />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, seen };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useClinicSettings', () => {
  it('asks the API which clinic this is', async () => {
    const { fetchImplementation, seen } = renderSettings(() =>
      Promise.resolve(jsonResponse(CLINIC)),
    );

    await waitFor(() => expect(seen.at(-1)).toEqual(CLINIC));
    const [call] = fetchImplementation.mock.calls;
    if (!call) throw new Error('Expected the clinic settings to be requested');
    expect(String(call[0])).toBe(`${BASE_URL}/clinic`);
  });

  it('hands back the timezone and the opening hours the server sent', async () => {
    const { seen } = renderSettings(() => Promise.resolve(jsonResponse(CLINIC)));

    await waitFor(() => expect(seen.at(-1)?.timeZone).toBe('America/Lima'));
    // These two values are the reason the calendar cannot be drawn from a constant.
    expect(seen.at(-1)?.operatingHours[0]?.opensAtLocalTime).toBe('08:00');
  });

  it('leaves the clinic undefined when the request fails', async () => {
    const { seen } = renderSettings(() =>
      Promise.resolve(jsonResponse({ message: 'no clinic' }, 500)),
    );

    // Undefined is what keeps the calendar from rendering: a grid with no timezone
    // would silently fall back to the browser's.
    await waitFor(() => expect(seen.at(-1)).toBeUndefined());
  });
});
