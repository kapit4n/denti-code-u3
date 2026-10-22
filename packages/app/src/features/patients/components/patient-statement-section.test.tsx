/**
 * Tests for the patient's statement section.
 *
 * What is being pinned down is the section's honesty about four things it could
 * easily guess: that it is not fetched until it is opened, that the lines are the
 * *server's* order and running balances rather than arithmetic the browser did, that
 * the days are read on the clinic's clock, and that an empty history and a failed
 * read are different sentences. None of them throws when they are wrong, so nothing
 * short of rendering the section catches them.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { formatClinicDay } from '../../clinic/format-clinic-time.js';
import { PatientStatementSection } from './patient-statement-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const STATEMENT_PATH = `/api/v1/patients/${PATIENT_ID}/statement`;
const TIME_ZONE = 'America/Lima';

const STATEMENT = {
  currency: 'USD',
  billedMinor: 30_000,
  paidMinor: 12_000,
  closingBalanceMinor: 18_000,
  entries: [
    {
      kind: 'INVOICE',
      id: 'invoice-1',
      reference: 'F001-00001',
      method: null,
      // 02:00Z on the 5th is still the 4th in Lima, so drawing this in UTC would
      // name the wrong day.
      occurredAt: '2026-10-05T02:00:00.000Z',
      debitMinor: 20_000,
      creditMinor: 0,
      balanceMinor: 20_000,
    },
    {
      kind: 'PAYMENT',
      id: 'payment-1',
      reference: '*** 4242',
      method: 'CARD',
      occurredAt: '2026-10-06T15:00:00.000Z',
      debitMinor: 0,
      creditMinor: 5_000,
      balanceMinor: 15_000,
    },
    {
      kind: 'INVOICE',
      id: 'invoice-2',
      reference: 'F001-00002',
      method: null,
      occurredAt: '2026-10-07T15:00:00.000Z',
      debitMinor: 10_000,
      creditMinor: 0,
      balanceMinor: 25_000,
    },
  ],
};

const EMPTY_STATEMENT = {
  currency: 'USD',
  billedMinor: 0,
  paidMinor: 0,
  closingBalanceMinor: 0,
  entries: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly statement?: Record<string, unknown>;
  readonly readFailure?: { readonly status: number; readonly body: unknown };
}

function renderSection(options: HarnessOptions = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.pathname === STATEMENT_PATH && method === 'GET') {
      if (options.readFailure) {
        return jsonResponse(options.readFailure.body, options.readFailure.status);
      }
      return jsonResponse(options.statement ?? STATEMENT);
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
        <PatientStatementSection patientId={PATIENT_ID} clinicTimeZone={TIME_ZONE} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

describe('PatientStatementSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not read the statement until it is opened', async () => {
    const user = userEvent.setup();
    renderSection();

    const card = screen.getByTestId('patient-statement');
    expect(card).toHaveTextContent('Show statement');
    expect(screen.queryAllByTestId('statement-entry')).toHaveLength(0);

    // The closed card makes no request at all — the report is opened, not mounted.
    expect(screen.queryByText('Loading the statement…')).toBeNull();
    await user.click(screen.getByTestId('open-statement'));

    expect(await screen.findByText('Invoice F001-00001')).toBeTruthy();
  });

  it('draws the lines in the server’s order with the server’s running balances', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByTestId('open-statement'));

    const rows = await screen.findAllByTestId('statement-entry');
    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent('Invoice F001-00001');
    expect(within(rows[0]!).getByTestId('statement-entry-amount')).toHaveTextContent('200.00 USD');
    expect(within(rows[0]!).getByTestId('statement-entry-balance')).toHaveTextContent(
      'Balance 200.00 USD',
    );

    // A payment is drawn as money leaving the balance, with its method and reference.
    expect(rows[1]).toHaveTextContent('Payment · CARD · *** 4242');
    expect(within(rows[1]!).getByTestId('statement-entry-amount')).toHaveTextContent('-50.00 USD');
    expect(within(rows[1]!).getByTestId('statement-entry-balance')).toHaveTextContent(
      'Balance 150.00 USD',
    );

    expect(rows[2]).toHaveTextContent('Invoice F001-00002');
    expect(within(rows[2]!).getByTestId('statement-entry-balance')).toHaveTextContent(
      'Balance 250.00 USD',
    );

    // The day is the clinic's: 02:00Z on the 5th is the 4th in Lima.
    expect(rows[0]).toHaveTextContent(formatClinicDay('2026-10-05T02:00:00.000Z', TIME_ZONE));

    expect(screen.getByTestId('statement-billed')).toHaveTextContent('300.00 USD');
    expect(screen.getByTestId('statement-paid')).toHaveTextContent('120.00 USD');
    expect(screen.getByTestId('statement-closing')).toHaveTextContent('180.00 USD');
  });

  it('says nothing has been billed or paid for an empty history', async () => {
    const user = userEvent.setup();
    renderSection({ statement: EMPTY_STATEMENT });

    await user.click(screen.getByTestId('open-statement'));

    expect(await screen.findByText('Nothing has been billed or paid yet.')).toBeTruthy();
    expect(screen.queryAllByTestId('statement-entry')).toHaveLength(0);
    expect(screen.queryByTestId('statement-closing')).toBeNull();
  });

  it('says the read failed rather than drawing an empty history', async () => {
    const user = userEvent.setup();
    renderSection({
      readFailure: {
        status: 501,
        body: { error: { code: 'INTERNAL_ERROR', message: 'no fixture', requestId: 't' } },
      },
    });

    await user.click(screen.getByTestId('open-statement'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The statement could not be loaded.');
    expect(screen.queryByText('Nothing has been billed or paid yet.')).toBeNull();
  });
});
