/**
 * The stored session.
 *
 * What is read back must be trustworthy enough to skip a login round-trip: a
 * half-written value, a missing field and an expired token all read as "no
 * session", because trusting any of them puts the app into a signed-in state that
 * fails every request.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { clearStoredSession, readStoredSession, writeStoredSession } from './session-storage.js';

const session = {
  token: 'token-123',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    clinicId: '00000000-0000-4000-8000-000000000002',
    email: 'admin@denti-code.test',
    fullName: 'Admin',
    role: 'ADMINISTRATOR' as const,
    isActive: true,
  },
};

afterEach(() => window.localStorage.clear());

describe('session storage', () => {
  it('round-trips a written session', () => {
    writeStoredSession(session);
    expect(readStoredSession()).toEqual(session);
  });

  it('reads a malformed value as no session', () => {
    window.localStorage.setItem('denti-code-session', '{ not json');
    expect(readStoredSession()).toBeUndefined();
  });

  it('reads a value missing the token as no session', () => {
    window.localStorage.setItem(
      'denti-code-session',
      JSON.stringify({ ...session, token: undefined }),
    );
    expect(readStoredSession()).toBeUndefined();
  });

  it('reads an expired session as no session', () => {
    window.localStorage.setItem(
      'denti-code-session',
      JSON.stringify({ ...session, expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    expect(readStoredSession()).toBeUndefined();
  });

  it('clears the stored session', () => {
    writeStoredSession(session);
    clearStoredSession();
    expect(window.localStorage.getItem('denti-code-session')).toBeNull();
  });
});
