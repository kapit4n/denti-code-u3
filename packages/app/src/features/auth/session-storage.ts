/**
 * The session, as the application holds it.
 *
 * A bearer token and the user it belongs to, kept in `localStorage` so a reload
 * does not log the operator out — the same mechanism, and the same deliberate
 * simplicity, as the theme preference. The token is a bearer credential: whoever
 * holds it is the user, which is why it is stored nowhere more privileged than
 * the page's own storage and why logout revokes it server-side rather than only
 * forgetting it here.
 *
 * This module is transport-aware but React-free: it reads and writes storage and
 * shapes the value. The React context that exposes it lives in
 * `session-provider.tsx`.
 */

const STORAGE_KEY = 'denti-code-session';

export interface SessionUser {
  readonly id: string;
  readonly clinicId: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: 'ADMINISTRATOR' | 'DENTIST' | 'ASSISTANT' | 'RECEPTIONIST';
  readonly isActive: boolean;
}

export interface StoredSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: SessionUser;
}

/**
 * Read the stored session, if any.
 *
 * Malformed JSON, a missing field or a past expiry all read as "no session": a
 * half-written value from a crashed tab must not put the app into a state where
 * it thinks it is logged in and then fails every request.
 */
export function readStoredSession(): StoredSession | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.expiresAt !== 'string' ||
      typeof parsed.user !== 'object' ||
      parsed.user === null
    ) {
      return undefined;
    }
    if (parsed.expiresAt <= new Date().toISOString()) {
      return undefined;
    }
    return parsed as StoredSession;
  } catch {
    return undefined;
  }
}

export function writeStoredSession(session: StoredSession): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
