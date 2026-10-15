/**
 * Tests for the patient's invoices section.
 *
 * What is being pinned down is the section's honesty about three things it could
 * easily guess: that the totals and the balance it draws are the *server's* stored
 * numbers rather than arithmetic it did itself, that an issued day is read on the
 * clinic's clock, and that an empty list and a failed read are different sentences.
 * None of them throws when they are wrong, so nothing short of rendering the
 * section catches them.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { formatClinicDay } from '../../clinic/format-clinic-time.js';
import { PatientInvoicesSection } from './patient-invoices-section.js';

const BASE_URL = 'http://api.test/api/v1';
const PATIENT_ID = 'patient-1';
const INVOICES_PATH = `/api/v1/patients/${PATIENT_ID}/invoices`;

const ISSUED_INVOICE = {
  id: 'invoice-1',
  number: 'F001-00001',
  status: 'ISSUED',
  currency: 'USD',
  subtotalMinor: 24_000,
  discountMinor: 1_000,
  taxRatePercent: 0,
  totalMinor: 23_000,
  allocatedMinor: 0,
  balanceMinor: 23_000,
  chargeCount: 2,
  // 02:00Z on the 5th is still the 4th in Lima — the fixture is built so the two
  // differ, so drawing it in UTC would name the wrong day.
  issuedAt: '2026-10-05T02:00:00.000Z',
  createdAt: '2026-10-05T02:00:00.000Z',
};

const PAID_INVOICE = {
  id: 'invoice-2',
  number: 'F001-00002',
  status: 'PAID',
  currency: 'USD',
  subtotalMinor: 12_000,
  discountMinor: 0,
  taxRatePercent: 0,
  totalMinor: 12_000,
  allocatedMinor: 12_000,
  balanceMinor: 0,
  chargeCount: 1,
  issuedAt: '2026-10-06T15:00:00.000Z',
  createdAt: '2026-10-06T15:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface HarnessOptions {
  readonly invoices?: { readonly items: readonly Record<string, unknown>[] };
  readonly readFailure?: { readonly status: number; readonly body: unknown };
}

function renderSection(options: HarnessOptions = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.pathname === INVOICES_PATH && method === 'GET') {
      if (options.readFailure) {
        return jsonResponse(options.readFailure.body, options.readFailure.status);
      }
      return jsonResponse(options.invoices ?? { items: [ISSUED_INVOICE, PAID_INVOICE] });
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
        <PatientInvoicesSection patientId={PATIENT_ID} clinicTimeZone="America/Lima" />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('PatientInvoicesSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('draws each document with its stored total, balance and charge count', async () => {
    renderSection();

    const rows = await screen.findAllByTestId('patient-invoice');
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent('F001-00001');
    expect(rows[0]).toHaveTextContent('ISSUED');
    // The server's stored total, formatted without a division in the component.
    expect(rows[0]!.querySelector('[data-testid="invoice-total"]')).toHaveTextContent('230.00 USD');
    expect(rows[0]).toHaveTextContent('2 charges');
    expect(rows[0]!.querySelector('[data-testid="invoice-balance"]')).toHaveTextContent(
      '230.00 USD outstanding',
    );

    // A settled document says so rather than showing a zero balance as a debt.
    expect(rows[1]!.querySelector('[data-testid="invoice-balance"]')).toHaveTextContent(
      'Paid in full',
    );
  });

  it('reads the issued day on the clinic’s clock, not the browser’s', async () => {
    renderSection();

    const row = (await screen.findAllByTestId('patient-invoice'))[0]!;
    const inLima = formatClinicDay(ISSUED_INVOICE.issuedAt, 'America/Lima');
    expect(row).toHaveTextContent(`issued ${inLima}`);
    expect(row).not.toHaveTextContent(ISSUED_INVOICE.issuedAt);
  });

  it('shows the empty sentence for a patient with nothing billed', async () => {
    renderSection({ invoices: { items: [] } });

    expect(await screen.findByText('No invoices for this patient yet.')).toBeTruthy();
  });

  it('says the read failed rather than showing an empty list', async () => {
    renderSection({
      readFailure: {
        status: 501,
        body: { error: { code: 'INTERNAL_ERROR', message: 'no fixture', requestId: 't' } },
      },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The invoices could not be loaded.');
    expect(screen.queryByText('No invoices for this patient yet.')).toBeNull();
  });

  it('does not claim a patient has no invoices while the read is in flight', async () => {
    renderSection();

    expect(screen.getByText('Loading the invoices…')).toBeTruthy();
    await screen.findAllByTestId('patient-invoice');
  });
});
