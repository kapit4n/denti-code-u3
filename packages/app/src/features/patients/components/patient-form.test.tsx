/**
 * The patient registration form.
 *
 * Rendered through the real providers with an `ApiClient` whose `fetch` is a
 * stub, so the test exercises the whole path — RHF, the Zod resolver, the
 * mutation hook and the client's request shaping — without a database. The
 * assertions are about what the user would see and what the server was asked
 * for, not about internal call shapes.
 */

import { ApiClient, ApiClientError } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientForm } from './patient-form.js';

const BASE_URL = 'http://api.test/api/v1';

/** One stubbed reply, keyed by the URL it answers. */
interface StubbedReply {
  readonly status: number;
  readonly body: unknown;
}

function renderForm(reply: StubbedReply, onRegistered = vi.fn()) {
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    }),
  );

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({
    // Retries would make a failing-request test wait out the backoff.
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiClientProvider baseUrl={BASE_URL} client={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );

  render(<PatientForm onRegistered={onRegistered} />, { wrapper });

  return { fetchImplementation, onRegistered };
}

/** The POST calls the client made, ignoring reads such as the profile prefetch. */
function postCalls(fetchImplementation: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return fetchImplementation.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
  ) as [string, RequestInit][];
}

/**
 * The first POST the client made.
 *
 * Throws rather than returning `undefined`: "the app never posted anything" is the
 * failure these tests exist to catch, and a thrown message says so, where an
 * assertion on `undefined?.body` fails somewhere less obvious.
 */
function firstPost(fetchImplementation: ReturnType<typeof vi.fn>) {
  const [first] = postCalls(fetchImplementation);

  if (!first) {
    throw new Error('Expected the form to make a POST request, but it made none');
  }

  const [url, init] = first;
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

const successReply: StubbedReply = {
  status: 201,
  body: {
    id: '22222222-2222-4222-8222-222222222222',
    clinicId: '11111111-1111-4111-8111-111111111111',
    recordNumber: 'P-000042',
    firstName: 'Ana',
    lastName: 'Gómez',
    preferredName: null,
    identificationNumber: null,
    phone: null,
    email: null,
    birthDate: null,
    isActive: true,
  },
};

const validationFailure: StubbedReply = {
  status: 422,
  body: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The birth date has not happened yet',
      requestId: 'req-1',
    },
  },
};

/** Fill only the two required fields, leaving the optional ones untouched. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First name'), 'Ana');
  await user.type(screen.getByLabelText('Last name'), 'Gómez');
}

describe('PatientForm', () => {
  it('posts the typed values to the patients endpoint', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm(successReply);

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    await waitFor(() => expect(postCalls(fetchImplementation)).toHaveLength(1));

    const { url, init, body } = firstPost(fetchImplementation);
    expect(url).toBe(`${BASE_URL}/patients`);
    expect(init.method).toBe('POST');
    expect(body).toMatchObject({ firstName: 'Ana', lastName: 'Gómez' });
  });

  it('prefetches the new profile so the chart opens without a spinner', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm(successReply);

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(
        fetchImplementation.mock.calls.filter(([url]) =>
          String(url).endsWith('/patients/22222222-2222-4222-8222-222222222222'),
        ),
      ).not.toHaveLength(0),
    );
  });

  it('sends no record number, because the server assigns it', async () => {
    // The number is per clinic and sequential. If the form ever posted one, a
    // client could choose a patient's chart number.
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm(successReply);

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
    expect(firstPost(fetchImplementation).body).not.toHaveProperty('recordNumber');
  });

  it('omits optional fields left blank rather than sending empty strings', async () => {
    // The regression the form schema exists for: an untouched input is '', and
    // the API rejects '' for an optional field. The receptionist who registers a
    // patient with only a name must not be blocked by the fields they skipped.
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm(successReply);

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
    expect(firstPost(fetchImplementation).body).toEqual({ firstName: 'Ana', lastName: 'Gómez' });
  });

  it('reports the assigned record number after a successful registration', async () => {
    const user = userEvent.setup();
    const { onRegistered } = renderForm(successReply);

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    await waitFor(() =>
      expect(onRegistered).toHaveBeenCalledWith({
        id: '22222222-2222-4222-8222-222222222222',
        recordNumber: 'P-000042',
      }),
    );
  });

  it('does not submit a form with a blank required name', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderForm(successReply);

    await user.type(screen.getByLabelText('First name'), 'Ana');
    await user.click(screen.getByTestId('register-submit'));

    // The name is empty once trimmed, and the error is next to the field rather
    // than only in a banner at the top of a long form.
    // The message sits next to the field, not only in a banner at the top of a
    // long form, and says what to do rather than quoting a schema.
    expect(await screen.findByText('Last name is required')).toBeInTheDocument();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('marks an invalid field with aria-invalid and describes the error', async () => {
    const user = userEvent.setup();
    renderForm(successReply);

    await user.type(screen.getByLabelText('First name'), '   ');
    await user.click(screen.getByTestId('register-submit'));

    const lastName = await screen.findByLabelText('Last name');
    await waitFor(() => expect(lastName).toHaveAttribute('aria-invalid', 'true'));

    // A screen reader has to be able to reach the message: `aria-describedby` has
    // to point at an element that exists.
    const describedBy = lastName.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const message = document.getElementById(String(describedBy));
    expect(message).not.toBeNull();
    expect(message).toHaveAttribute('role', 'alert');
  });

  it('shows the server message when the API rejects the birth date', async () => {
    const user = userEvent.setup();
    renderForm(validationFailure);

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText('Date of birth'), '2999-01-01');
    await user.click(screen.getByTestId('register-submit'));

    // The client-side schema cannot know the date has not happened; the domain
    // rule lives on the server. Showing its message beats a generic failure.
    expect(await screen.findByTestId('register-error')).toHaveTextContent(
      'The birth date has not happened yet',
    );
  });

  it('keeps the typed values after a rejected submission', async () => {
    const user = userEvent.setup();
    renderForm(validationFailure);

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    await screen.findByTestId('register-error');

    // Clearing the form on failure would make the receptionist retype everything
    // to fix one field.
    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
    expect(screen.getByLabelText('Last name')).toHaveValue('Gómez');
  });

  it('explains an unreachable server instead of failing silently', async () => {
    const user = userEvent.setup();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <QueryClientProvider client={queryClient}>
          <PatientForm onRegistered={vi.fn()} />
        </QueryClientProvider>
      </ApiClientProvider>,
    );

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('register-error')).toHaveTextContent(
      /could not reach the server/i,
    );
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetchImplementation = vi.fn<typeof fetch>().mockReturnValue(
      pending.then(
        () =>
          new Response(JSON.stringify(successReply.body), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <QueryClientProvider client={queryClient}>
          <PatientForm onRegistered={vi.fn()} />
        </QueryClientProvider>
      </ApiClientProvider>,
    );

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    // Without this, a second click posts the same patient twice and the second
    // request is the one that surprises the receptionist.
    await waitFor(() => expect(screen.getByTestId('register-submit')).toBeDisabled());
    expect(screen.getByRole('status')).toHaveTextContent(/saving/i);

    release?.();
    await waitFor(() => expect(screen.getByTestId('register-submit')).toBeEnabled());
  });

  it('reports a conflict rather than a generic failure', async () => {
    const user = userEvent.setup();
    renderForm({
      status: 409,
      body: {
        error: {
          code: 'DOMAIN_RULE_VIOLATION',
          message: 'That record number is already taken',
          requestId: 'req-2',
        },
      },
    });

    await fillRequiredFields(user);
    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByTestId('register-error')).toHaveTextContent(
      'That record number is already taken',
    );
  });
});

describe('ApiClientError', () => {
  it('is what the API client throws, so the form can switch on its code', () => {
    // Guards the form's `switch (apiError.code)`: if the client ever stopped
    // throwing this type, every failure would fall through to the generic
    // message and the specific ones would silently stop working.
    expect(new ApiClientError('NETWORK_ERROR', 'nope', 0)).toBeInstanceOf(Error);
  });
});
