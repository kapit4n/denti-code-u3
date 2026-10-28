/**
 * The login screen.
 *
 * Three properties matter and each of them is about what the operator sees when
 * something is wrong: a wrong password shows the same message for every failure,
 * a successful login reaches the session, and the form does not claim success
 * while the request is in flight.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClient } from '@denti-code-u3/api-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { SessionProvider } from '../session-provider.js';
import { LoginPage } from './login-page.js';

afterEach(() => {
  window.localStorage.clear();
});

function renderLogin(fetchImplementation: typeof fetch) {
  const client = new ApiClient({
    baseUrl: 'http://api.test/api/v1',
    fetchImplementation,
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiClientProvider baseUrl="http://api.test/api/v1" client={client}>
        <SessionProvider>
          <LoginPage />
        </SessionProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function fillAndSubmit(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

const successBody = {
  token: 'token-123',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    clinicId: '00000000-0000-4000-8000-000000000002',
    email: 'admin@denti-code.test',
    fullName: 'Admin',
    role: 'ADMINISTRATOR',
    isActive: true,
  },
};

describe('LoginPage', () => {
  it('keeps the session and stores the token on success', async () => {
    const fetchImplementation = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify(successBody), { status: 200 })),
    ) as unknown as typeof fetch;

    renderLogin(fetchImplementation);
    fillAndSubmit('admin@denti-code.test', 'secret');

    await waitFor(() => {
      expect(window.localStorage.getItem('denti-code-session')).toContain('token-123');
    });
  });

  it('shows one message for a refused login', async () => {
    const fetchImplementation = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'UNAUTHENTICATED', message: 'The email or password is incorrect' },
          }),
          { status: 401 },
        ),
      ),
    ) as unknown as typeof fetch;

    renderLogin(fetchImplementation);
    fillAndSubmit('admin@denti-code.test', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    );
    expect(window.localStorage.getItem('denti-code-session')).toBeNull();
  });

  it('says it is throttled rather than blaming the password', async () => {
    const fetchImplementation = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many sign-in attempts. Try again later.',
              requestId: 'req-1',
            },
          }),
          { status: 429, headers: { 'retry-after': '900' } },
        ),
      ),
    ) as unknown as typeof fetch;

    renderLogin(fetchImplementation);
    fillAndSubmit('admin@denti-code.test', 'secret');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many sign-in attempts. Try again later.',
    );
    expect(window.localStorage.getItem('denti-code-session')).toBeNull();
    // A production API has no development chooser; a refused request hides it.
    expect(screen.queryByTestId('dev-login')).toBeNull();
  });

  it('offers the seeded users and signs in as one without a password', async () => {
    const devUser = { ...successBody.user, fullName: 'Dev Admin' };
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/auth/dev-users')) {
        return new Response(JSON.stringify({ items: [devUser] }), { status: 200 });
      }
      if (url.endsWith('/auth/dev-login')) {
        return new Response(
          JSON.stringify({ token: 'dev-token', expiresAt: successBody.expiresAt, user: devUser }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 500 });
    }) as unknown as typeof fetch;

    renderLogin(fetchImplementation);

    fireEvent.click(await screen.findByRole('button', { name: /sign in as dev admin/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem('denti-code-session')).toContain('dev-token');
    });
  });
});
