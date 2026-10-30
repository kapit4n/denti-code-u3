/**
 * Tests for the patient's balance section.
 *
 * What is being pinned down is the section's honesty about the three states a
 * column of digits cannot tell apart — money owed, nothing owed, and money in
 * credit — and about the two things it could easily guess: that the five figures
 * are the *server's* arithmetic rather than a sum it did over the list below it,
 * and that a failed read is not the same sentence as a zero balance. None of them
 * throws when they are wrong, so nothing short of rendering the section catches
 * them.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientBalanceSection } from './patient-balance-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const BALANCE_PATH = `/api/v1/patients/${PATIENT_ID}/balance`;

const OUTSTANDING = {
  currency: 'USD',
  billedMinor: 45_000,
  allocatedMinor: 23_000,
  outstandingMinor: 22_000,
  unallocatedPaymentsMinor: 0,
  balanceMinor: 22_000,
};

const SETTLED = {
  currency: 'USD',
  billedMinor: 12_000,
  allocatedMinor: 12_000,
  outstandingMinor: 0,
  unallocatedPaymentsMinor: 0,
  balanceMinor: 0,
};

const IN_CREDIT = {
  currency: 'USD',
  billedMinor: 12_000,
  allocatedMinor: 12_000,
  outstandingMinor: 0,
  unallocatedPaymentsMinor: 5_000,
  balanceMinor: -5_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly balance?: Record<string, unknown>;
  readonly readFailure?: { readonly status: number; readonly body: unknown };
  readonly onRecordPayment?: () => void;
}

function renderSection(options: HarnessOptions = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.pathname === BALANCE_PATH && method === 'GET') {
      if (options.readFailure) {
        return jsonResponse(options.readFailure.body, options.readFailure.status);
      }
      return jsonResponse(options.balance ?? OUTSTANDING);
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
        <PatientBalanceSection
          patientId={PATIENT_ID}
          {...(options.onRecordPayment ? { onRecordPayment: options.onRecordPayment } : {})}
        />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('PatientBalanceSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws the owed amount, named, with the server’s own five figures under it', async () => {
    renderSection();

    const value = await screen.findByTestId('patient-balance-value');
    expect(value).toHaveTextContent('220.00 USD');
    expect(screen.getByTestId('patient-balance-state')).toHaveTextContent('Outstanding');

    expect(screen.getByTestId('patient-balance-billed')).toHaveTextContent('450.00 USD');
    expect(screen.getByTestId('patient-balance-allocated')).toHaveTextContent('230.00 USD');
    expect(screen.getByTestId('patient-balance-outstanding')).toHaveTextContent('220.00 USD');
  });

  it('offers recording when the server says money is owed', async () => {
    const onRecordPayment = vi.fn();
    renderSection({ onRecordPayment });

    expect(await screen.findByTestId('patient-record-payment')).toBeEnabled();
  });

  it('says nothing is owed rather than showing a bare zero', async () => {
    renderSection({ balance: SETTLED, onRecordPayment: vi.fn() });

    expect(await screen.findByTestId('patient-balance-value')).toHaveTextContent('0.00 USD');
    expect(screen.getByTestId('patient-balance-state')).toHaveTextContent('Nothing owed');
    // A settled ledger has no unapplied money, so the row that would report credit
    // is not drawn at all.
    expect(screen.queryByTestId('patient-balance-unallocated')).toBeNull();
    expect(screen.queryByTestId('patient-record-payment')).toBeNull();
  });

  it('names money in credit as credit, with the payments that caused it', async () => {
    renderSection({ balance: IN_CREDIT });

    expect(await screen.findByTestId('patient-balance-value')).toHaveTextContent('-50.00 USD');
    expect(screen.getByTestId('patient-balance-state')).toHaveTextContent('Credit on account');
    expect(screen.getByTestId('patient-balance-unallocated')).toHaveTextContent('50.00 USD');
  });

  it('says the read failed rather than showing a zero balance', async () => {
    renderSection({
      readFailure: {
        status: 501,
        body: { error: { code: 'INTERNAL_ERROR', message: 'no fixture', requestId: 't' } },
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The balance could not be loaded.');
    expect(screen.queryByTestId('patient-balance-value')).toBeNull();
  });

  it('does not claim a patient owes nothing while the read is in flight', async () => {
    renderSection();

    expect(screen.getByText('Loading the balance…')).toBeTruthy();
    await screen.findByTestId('patient-balance-value');
  });
});
