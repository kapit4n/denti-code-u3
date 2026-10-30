import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../../i18n/index.js';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { RecordPaymentDialog } from './record-payment-dialog.js';

const BASE_URL = 'http://api.test/api/v1';
const ANA_ID = 'patient-1';
const INVOICE_ID = 'invoice-1';
const INVOICES_PATH = `/api/v1/patients/${ANA_ID}/invoices`;
const BALANCE_PATH = `/api/v1/patients/${ANA_ID}/balance`;
const INVOICE_DETAIL_PATH = `/api/v1/invoices/${INVOICE_ID}`;

const ANA = {
  id: ANA_ID,
  recordNumber: 'P-000001',
  firstName: 'Ana',
  lastName: 'Torres',
  preferredName: null,
  phone: null,
  email: null,
  birthDate: null,
  isActive: true,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const OPEN_INVOICE = {
  id: INVOICE_ID,
  patientId: ANA_ID,
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
  issuedAt: '2026-10-05T02:00:00.000Z',
  createdAt: '2026-10-05T02:00:00.000Z',
};

const PAID_INVOICE = {
  ...OPEN_INVOICE,
  id: 'invoice-2',
  number: 'F001-00002',
  status: 'PAID',
  totalMinor: 12_000,
  allocatedMinor: 12_000,
  balanceMinor: 0,
  chargeCount: 1,
};

const BALANCE = {
  currency: 'USD',
  billedMinor: 23_000,
  allocatedMinor: 0,
  outstandingMinor: 23_000,
  unallocatedPaymentsMinor: 0,
  balanceMinor: 23_000,
};

const INVOICE_DETAIL = {
  ...OPEN_INVOICE,
  charges: [
    {
      id: 'charge-1',
      clinicId: 'clinic-1',
      patientId: ANA_ID,
      visitId: null,
      invoiceId: INVOICE_ID,
      invoicedAt: '2026-10-05T02:00:00.000Z',
      createdAt: '2026-10-05T01:00:00.000Z',
      treatmentId: null,
      treatmentPlanItemId: null,
      description: 'Composite filling',
      quantity: 1,
      unitPriceMinor: 12_000,
      discountMinor: 0,
      taxRatePercent: 0,
      currency: 'USD',
    },
    {
      id: 'charge-2',
      clinicId: 'clinic-1',
      patientId: ANA_ID,
      visitId: null,
      invoiceId: INVOICE_ID,
      invoicedAt: '2026-10-05T02:00:00.000Z',
      createdAt: '2026-10-05T01:30:00.000Z',
      treatmentId: null,
      treatmentPlanItemId: null,
      description: 'Scaling and prophylaxis',
      quantity: 2,
      unitPriceMinor: 6_000,
      discountMinor: 1_000,
      taxRatePercent: 0,
      currency: 'USD',
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
  readonly invoices?: { readonly items: readonly Record<string, unknown>[] };
  readonly paymentFailure?: { readonly status: number; readonly body: unknown };
  readonly fixedPatient?: { readonly id: string; readonly label: string };
}

function renderDialog(options: HarnessOptions = {}) {
  const requests: { readonly method: string; readonly path: string; readonly body: unknown }[] = [];
  const onClose = vi.fn();

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push({
      method,
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    if (url.pathname === '/api/v1/patients' && method === 'GET') {
      return jsonResponse({ items: [ANA] });
    }

    if (url.pathname === INVOICES_PATH && method === 'GET') {
      return jsonResponse(options.invoices ?? { items: [OPEN_INVOICE, PAID_INVOICE] });
    }

    if (url.pathname === BALANCE_PATH && method === 'GET') {
      return jsonResponse(BALANCE);
    }

    if (url.pathname === INVOICE_DETAIL_PATH && method === 'GET') {
      return jsonResponse(INVOICE_DETAIL);
    }

    if (url.pathname === `/api/v1/invoices/${INVOICE_ID}/payments` && method === 'POST') {
      if (options.paymentFailure) {
        return jsonResponse(options.paymentFailure.body, options.paymentFailure.status);
      }
      return jsonResponse(
        {
          id: 'payment-1',
          clinicId: 'clinic-1',
          patientId: ANA_ID,
          currency: 'USD',
          method: 'CARD',
          amountMinor: 23_000,
          reference: 'front desk',
          receivedAt: '2026-10-06T16:00:00.000Z',
        },
        201,
      );
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
    <I18nProvider initialLocale="en">
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider baseUrl={BASE_URL} client={client}>
          <RecordPaymentDialog
            {...(options.fixedPatient ? { fixedPatient: options.fixedPatient } : {})}
            onClose={onClose}
          />
        </ApiClientProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );

  return { requests, onClose };
}

async function choosePatient(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Patient/), 'Ana');
  await user.click(await screen.findByRole('option', { name: /Ana Torres/ }));
}

async function chooseOpenInvoice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('payments-record-invoice'));
  await user.click(await screen.findByRole('option', { name: /F001-00001/ }));
}

async function chooseCash(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('payments-record-method'));
  await user.click(await screen.findByRole('option', { name: 'Cash' }));
}

describe('RecordPaymentDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('waits for a patient, lists only open invoices, and posts the chosen payment', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { requests, onClose } = renderDialog();

    expect(requests.some((request) => request.path === INVOICES_PATH)).toBe(false);

    await choosePatient(user);
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'GET',
        path: INVOICES_PATH,
        body: undefined,
      }),
    );

    expect(await screen.findByTestId('payments-record-patient')).toHaveTextContent('Ana Torres');
    expect(await screen.findByTestId('payments-record-patient-balance')).toHaveTextContent(
      'Owes 230.00 USD',
    );

    await user.click(screen.getByTestId('payments-record-invoice'));
    expect(screen.queryByText(/F001-00002/)).toBeNull();
    await user.click(await screen.findByRole('option', { name: /F001-00001/ }));

    expect(screen.getByTestId('payments-record-amount')).toHaveValue('230.00');
    expect(screen.getByTestId('payments-record-outstanding')).toHaveTextContent(
      '230.00 USD outstanding',
    );

    expect(await screen.findByText('Composite filling')).toBeTruthy();
    expect(screen.getByText(/Scaling and prophylaxis/)).toHaveTextContent('×2');

    await chooseCash(user);
    await user.type(screen.getByTestId('payments-record-reference'), 'front desk');
    await user.click(screen.getByTestId('payments-record-submit'));

    await waitFor(() => {
      expect(requests).toContainEqual({
        method: 'POST',
        path: `/api/v1/invoices/${INVOICE_ID}/payments`,
        body: { method: 'CASH', amountMinor: 23_000, reference: 'front desk' },
      });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('opens for a fixed patient without asking who they are', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderDialog({ fixedPatient: { id: ANA_ID, label: 'Ana Torres' } });

    expect(await screen.findByTestId('payments-record-patient')).toHaveTextContent('Ana Torres');
    expect(await screen.findByTestId('payments-record-patient-balance')).toHaveTextContent(
      'Owes 230.00 USD',
    );
    expect(screen.queryByLabelText(/^Patient/)).toBeNull();

    await waitFor(() => expect(screen.getByTestId('payments-record-amount')).toBeEnabled());
    expect(screen.getByTestId('payments-record-amount')).toHaveValue('230.00');

    await chooseOpenInvoice(user);
    expect(await screen.findByText('Composite filling')).toBeTruthy();
  });

  it('says a patient has nothing open instead of offering a dead amount field', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderDialog({ invoices: { items: [PAID_INVOICE] } });

    await choosePatient(user);

    expect(await screen.findByTestId('payments-record-no-invoices')).toHaveTextContent(
      'This patient has no open invoices to pay.',
    );
    expect(screen.queryByTestId('payments-record-invoice')).toBeNull();
    expect(screen.queryByTestId('payments-record-amount')).toBeNull();
    expect(screen.queryByTestId('payments-record-method')).toBeNull();
    expect(screen.queryByTestId('payments-record-submit')).toBeNull();
  });

  it('keeps the draft open and quotes a rejected payment', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onClose } = renderDialog({
      paymentFailure: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A payment cannot exceed the invoice balance',
            requestId: 't',
          },
        },
      },
    });

    await choosePatient(user);
    await chooseOpenInvoice(user);
    await chooseCash(user);
    await user.clear(screen.getByTestId('payments-record-amount'));
    await user.type(screen.getByTestId('payments-record-amount'), '999.00');
    await user.click(screen.getByTestId('payments-record-submit'));

    expect(await screen.findByTestId('payments-record-error')).toHaveTextContent(
      'A payment cannot exceed the invoice balance',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
