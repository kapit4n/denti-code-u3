import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { ChangePasswordCard } from './change-password-card.js';

const BASE_URL = 'http://api.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderCard(status = 204) {
  const fetchImplementation = vi.fn<typeof fetch>(async () => {
    if (status === 204) {
      return new Response(null, { status: 204 });
    }
    return jsonResponse(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'The email or password is incorrect',
          requestId: 'test',
        },
      },
      status,
    );
  });
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <ChangePasswordCard />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation };
}

describe('ChangePasswordCard', () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('posts only the two password fields after they match', async () => {
    const { fetchImplementation } = renderCard();
    await user.type(screen.getByTestId('password-current'), 'old-password');
    await user.type(screen.getByTestId('password-new'), 'new-password-long');
    await user.type(screen.getByTestId('password-confirm'), 'new-password-long');
    await user.click(screen.getByTestId('password-submit'));

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/api/v1/auth/change-password');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password-long',
    });
    expect(await screen.findByText('Password changed.')).toBeTruthy();
  });

  it('refuses a mismatch without calling the API', async () => {
    const { fetchImplementation } = renderCard();
    await user.type(screen.getByTestId('password-current'), 'old-password');
    await user.type(screen.getByTestId('password-new'), 'new-password-long');
    await user.type(screen.getByTestId('password-confirm'), 'different-password');
    await user.click(screen.getByTestId('password-submit'));

    expect(await screen.findByText('The new passwords do not match.')).toBeTruthy();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('shows a specific message when the current password is wrong', async () => {
    renderCard(401);
    await user.type(screen.getByTestId('password-current'), 'wrong-password');
    await user.type(screen.getByTestId('password-new'), 'new-password-long');
    await user.type(screen.getByTestId('password-confirm'), 'new-password-long');
    await user.click(screen.getByTestId('password-submit'));

    expect(await screen.findByText('The current password is incorrect.')).toBeTruthy();
  });
});
