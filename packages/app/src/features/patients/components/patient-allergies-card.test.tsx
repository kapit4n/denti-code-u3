import { ApiClient } from '@denti-code-u3/api-client';
import type { PatientProfile } from '@denti-code-u3/domain';
import { asClinicId, asPatientId } from '@denti-code-u3/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientAllergiesCard, withAddedAllergy } from './patient-allergies-card.js';

const BASE_URL = 'http://api.test/api/v1';

const patient: PatientProfile = {
  id: asPatientId('pat-1'),
  clinicId: asClinicId('cli-1'),
  recordNumber: 'P-000042',
  firstName: 'Ana',
  lastName: 'García',
  preferredName: 'Ana María',
  identificationNumber: 'CC-OLD-1',
  phone: '+57 300 111 1111',
  email: 'old@example.test',
  birthDate: '1990-04-17',
  isActive: true,
  address: null,
  allergies: 'Penicillin',
  additionalData: {},
  createdAt: '2024-01-15T09:30:00.000Z',
  updatedAt: '2024-01-15T09:30:00.000Z',
  upcomingAppointment: null,
  recentVisits: [],
  outstandingTreatments: [],
  financialBalance: { outstandingMinor: 0, chargeCount: 0, currencyCode: null },
};

function renderCard(options: { readonly status?: number; readonly current?: PatientProfile } = {}) {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
    options.status && options.status !== 204
      ? new Response(
          JSON.stringify({
            error: { code: 'UNEXPECTED', message: '', requestId: 'test' },
          }),
          { status: options.status, headers: { 'content-type': 'application/json' } },
        )
      : new Response(null, { status: 204 }),
  );

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiClientProvider baseUrl={BASE_URL} client={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );

  render(<PatientAllergiesCard patient={options.current ?? patient} />, { wrapper });

  return { fetchImplementation };
}

function putRequest(fetchImplementation: ReturnType<typeof vi.fn>) {
  const call = fetchImplementation.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
  ) as [string, RequestInit] | undefined;

  return {
    url: call?.[0],
    body: call?.[1]?.body ? JSON.parse(call[1].body as string) : undefined,
  };
}

describe('withAddedAllergy', () => {
  it('appends to the recorded allergies without replacing them', () => {
    expect(withAddedAllergy('Penicillin', 'Latex')).toBe('Penicillin, Latex');
  });

  it('uses the new allergy when none were recorded', () => {
    expect(withAddedAllergy(null, '  Latex  ')).toBe('Latex');
  });

  it('does not add an allergy that is already listed', () => {
    expect(withAddedAllergy('Penicillin, latex', 'Latex')).toBe('Penicillin, latex');
  });
});

describe('PatientAllergiesCard', () => {
  it('shows the recorded allergies and the quick add action', () => {
    renderCard();

    expect(screen.getByText('Penicillin')).toBeInTheDocument();
    expect(screen.getByTestId('add-allergy')).toHaveTextContent('Add allergy');
  });

  it('adds an allergy with a full patient update', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderCard();

    await user.click(screen.getByTestId('add-allergy'));
    await user.type(screen.getByTestId('allergy-input'), 'Latex');
    await user.click(screen.getByTestId('allergy-submit'));

    await waitFor(() => {
      expect(putRequest(fetchImplementation).body).toBeDefined();
    });

    expect(putRequest(fetchImplementation).url).toBe(`${BASE_URL}/patients/${patient.id}`);
    expect(putRequest(fetchImplementation).body).toMatchObject({
      firstName: 'Ana',
      lastName: 'García',
      preferredName: 'Ana María',
      phone: '+57 300 111 1111',
      email: 'old@example.test',
      allergies: 'Penicillin, Latex',
    });
    await waitFor(() => {
      expect(screen.queryByTestId('allergy-input')).not.toBeInTheDocument();
    });
  });

  it('reports a refused update without discarding the draft', async () => {
    const user = userEvent.setup();
    renderCard({ status: 422 });

    await user.click(screen.getByTestId('add-allergy'));
    await user.type(screen.getByTestId('allergy-input'), 'Latex');
    await user.click(screen.getByTestId('allergy-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The allergy could not be added. Try again.',
    );
    expect(screen.getByTestId('allergy-input')).toHaveValue('Latex');
  });
});
