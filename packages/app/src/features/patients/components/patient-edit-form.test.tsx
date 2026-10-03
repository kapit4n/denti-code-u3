/**
 * The patient edit form.
 *
 * Rendered through the real providers with a stubbed `fetch`, so the test
 * exercises RHF, the Zod resolver, the mutation and the client's request shaping
 * without a database. Two things are worth testing here that the API tests cannot
 * prove:
 *
 *  - the form is prefilled from the record, so an edit never starts blank;
 *  - clearing a field produces a body *without* that field, which is what makes the
 *    endpoint's PUT semantics reachable from the UI.
 */

import { ApiClient, ApiClientError } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientEditForm } from './patient-edit-form.js';
import { describePatientFailure } from '../describe-patient-failure.js';
import type { PatientProfile } from '../hooks/use-patients.js';

const BASE_URL = 'http://api.test/api/v1';

const patient: PatientProfile = {
  id: 'pat-1',
  clinicId: 'cli-1',
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
  allergies: null,
  additionalData: {},
  createdAt: '2024-01-15T09:30:00.000Z',
  updatedAt: '2024-01-15T09:30:00.000Z',
  upcomingAppointment: null,
  recentVisits: [],
  outstandingTreatments: [],
  financialBalance: { outstandingMinor: 0, chargeCount: 0, currencyCode: null },
};

function renderForm(
  options: { readonly reply?: { status: number; body: unknown }; readonly offline?: boolean } = {},
) {
  const reply = options.reply ?? { status: 204, body: undefined };

  // An unreachable server is a thrown fetch, not a status code: there is no status
  // 0 to construct, and the client's NETWORK_ERROR path is the one under test.
  const fetchImplementation = options.offline
    ? vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    : vi.fn<typeof fetch>().mockResolvedValue(
        reply.status === 204
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(reply.body), {
              status: reply.status,
              headers: { 'content-type': 'application/json' },
            }),
      );

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSaved = vi.fn();
  const onCancel = vi.fn();

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiClientProvider baseUrl={BASE_URL} client={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );

  render(<PatientEditForm patient={patient} onSaved={onSaved} onCancel={onCancel} />, {
    wrapper,
  });

  return { fetchImplementation, onSaved, onCancel };
}

/** The write request, as the server would receive it. */
function editRequest(fetchImplementation: ReturnType<typeof vi.fn>) {
  const call = fetchImplementation.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
  ) as [string, RequestInit] | undefined;

  return {
    url: call?.[0],
    method: call?.[1]?.method,
    body: call?.[1]?.body ? JSON.parse(call[1].body as string) : undefined,
  };
}

describe('PatientEditForm', () => {
  it('starts from the stored values, not from blanks', () => {
    renderForm();

    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
    expect(screen.getByLabelText('Last name')).toHaveValue('García');
    expect(screen.getByLabelText('Preferred name')).toHaveValue('Ana María');
    expect(screen.getByLabelText('Email')).toHaveValue('old@example.test');
    expect(screen.getByLabelText('Date of birth')).toHaveValue('1990-04-17');
  });

  it('sends a PUT to the patient, not to the list', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm();

    await user.clear(screen.getByLabelText('Preferred name'));
    await user.click(screen.getByTestId('update-submit'));

    await waitFor(() => {
      expect(editRequest(fetchImplementation).method).toBe('PUT');
    });

    // The list endpoint and a POST here would both be plausible mistakes, and both
    // would appear to work against a mock that does not care.
    expect(editRequest(fetchImplementation).url).toBe(`${BASE_URL}/patients/${patient.id}`);
  });

  it('omits a field the user cleared, so the server stores it as empty', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm();

    // The scenario the PUT endpoint exists for: an email recorded in error.
    await user.clear(screen.getByLabelText('Email'));
    await user.click(screen.getByTestId('update-submit'));

    await waitFor(() => {
      expect(editRequest(fetchImplementation).body).toBeDefined();
    });

    const body = editRequest(fetchImplementation).body as Record<string, unknown>;

    // Absent, not `''` and not the old value: the same shape registration sends,
    // and the one the endpoint reads as "no email".
    expect(body).not.toHaveProperty('email');
    // Untouched fields are still sent, because the endpoint replaces the set.
    expect(body).toMatchObject({ firstName: 'Ana', lastName: 'García', phone: '+57 300 111 1111' });
  });

  it('never sends the record number, even though the record has one', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm();

    await user.click(screen.getByTestId('update-submit'));

    await waitFor(() => {
      expect(editRequest(fetchImplementation).body).toBeDefined();
    });

    // ADR 0015. There is no input for it, and the form's type does not carry it,
    // so this asserts the whole request rather than one absent field.
    expect(JSON.stringify(editRequest(fetchImplementation).body)).not.toContain('P-000042');
  });

  it("reports a rejection from the server in the user's terms", async () => {
    const user = userEvent.setup();
    renderForm({
      reply: {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The date of birth is in the future',
            requestId: 'req-1',
          },
        },
      },
    });

    await user.click(screen.getByTestId('update-submit'));

    // The server knows what is wrong; relaying its message beats "something went
    // wrong", which leaves the receptionist guessing.
    expect(await screen.findByTestId('update-error')).toHaveTextContent(
      'The date of birth is in the future',
    );
  });

  it('says so plainly when the patient is gone', async () => {
    const user = userEvent.setup();
    renderForm({
      reply: {
        status: 404,
        body: {
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: 'req-1',
          },
        },
      },
    });

    await user.click(screen.getByTestId('update-submit'));

    // A bare 404 message naming "this clinic" reads like the user's mistake. The
    // likelier cause is that the record was withdrawn while the form was open.
    expect(await screen.findByTestId('update-error')).toHaveTextContent('no longer exists');
  });

  it('explains an unreachable server instead of showing a raw error', async () => {
    const user = userEvent.setup();
    renderForm({ offline: true });

    await user.click(screen.getByTestId('update-submit'));

    expect(await screen.findByTestId('update-error')).toHaveTextContent(
      'Could not reach the server',
    );
  });

  it('keeps the values and stays editable when the save fails', async () => {
    const user = userEvent.setup();
    renderForm({
      reply: {
        status: 500,
        body: {
          error: { code: 'INTERNAL_ERROR', message: 'Something broke', requestId: 'r' },
        },
      },
    });

    await user.clear(screen.getByLabelText('Phone'));
    await user.click(screen.getByTestId('update-submit'));

    await screen.findByTestId('update-error');

    // Resetting the form on failure would make the receptionist retype a patient's
    // name because the server was briefly unwell.
    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
    expect(screen.getByLabelText('Phone')).toHaveValue('');
  });

  it('calls onSaved once the server has stored the edit', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderForm();

    await user.click(screen.getByTestId('update-submit'));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('cancels without writing anything', async () => {
    const user = userEvent.setup();
    const { fetchImplementation, onCancel } = renderForm();

    await user.type(screen.getByLabelText('Phone'), '999');
    await user.click(screen.getByTestId('update-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    // Discarding an edit must not send half of it.
    expect(editRequest(fetchImplementation).method).toBeUndefined();
  });

  it('rejects an empty name before asking the server', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm();

    await user.clear(screen.getByLabelText('First name'));
    await user.click(screen.getByTestId('update-submit'));

    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    // The resolver runs first, so a known-invalid form never becomes a request.
    expect(editRequest(fetchImplementation).method).toBeUndefined();
  });
});

describe('describePatientFailure', () => {
  it('falls back to the caller wording when the API sent no message', () => {
    // An error with an empty message is exactly what a proxy or an unhandled
    // server fault produces. Passing it through would render an empty alert box,
    // which reads as "no error" while the save silently failed.
    expect(describePatientFailure(new ApiClientError('INTERNAL_ERROR', '', 500), 'Fallback.')).toBe(
      'Fallback.',
    );
  });

  it('prefers the server wording when there is one', () => {
    expect(
      describePatientFailure(
        new ApiClientError('VALIDATION_ERROR', 'The date of birth is in the future', 422),
        'Fallback.',
      ),
    ).toBe('The date of birth is in the future');
  });

  it('returns nothing when there is no error', () => {
    expect(describePatientFailure(undefined, 'Fallback.')).toBeUndefined();
  });
});
