/**
 * Authentication rules.
 *
 * The repositories and the hasher are hand-written fakes: the use cases make a
 * handful of calls, so recording them reads better than asserting on call counts
 * and keeps crypto out of a rules test. The hasher is intentionally trivial —
 * the real scrypt hasher is exercised by its own infrastructure test.
 */

import { describe, expect, it } from 'vitest';

import type { ClinicId, IsoDateTime, UserId } from '@denti-code-u3/types';
import {
  login,
  logout,
  resolvePrincipal,
  isSessionExpired,
  assertSessionUsable,
  assertUserActive,
  type AuthDependencies,
  type AuthenticatedUser,
  type Session,
} from './index.js';
import type { SessionRepository, UserRepository } from '../ports/index.js';
import type { UserWithCredentials } from './auth.js';
import { DomainError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/id-generator.js';
import type { PasswordHasher, TokenGenerator } from '../shared/security.js';

const CLINIC = '11111111-1111-4111-8111-111111111111' as ClinicId;
const OTHER_CLINIC = '11111111-1111-4111-8111-222222222222' as ClinicId;
const USER_ID = 'u-0001' as UserId;

function fixedClock(at = '2026-10-22T10:00:00.000Z'): Clock {
  return { now: () => at as IsoDateTime };
}

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { nextId: () => `session-${++counter}` };
}

/** Mirrors the real one closely enough for rule tests: `hash` is reversible by construction. */
const plainHasher: PasswordHasher = {
  async hash(password) {
    return `plain:${password}`;
  },
  async verify(password, stored) {
    return stored === `plain:${password}`;
  },
};

const fixedTokenGenerator: TokenGenerator = {
  nextToken: () => 'token-abc',
  hashToken: (token) => `hash(${token})`,
};

function activeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ID,
    clinicId: CLINIC,
    email: 'admin@clinic.test',
    fullName: 'Ada Admin',
    role: 'ADMINISTRATOR',
    isActive: true,
    ...overrides,
  };
}

interface FakeUsers extends UserRepository {
  readonly saved: (AuthenticatedUser & { readonly passwordHash: string })[];
  readonly loggedIn: { userId: string; at: string }[];
  credentials?: UserWithCredentials;
  byId?: AuthenticatedUser;
}

function fakeUsers(): FakeUsers {
  const saved: (AuthenticatedUser & { readonly passwordHash: string })[] = [];
  const loggedIn: { userId: string; at: string }[] = [];
  return {
    saved,
    loggedIn,
    async findByEmailForLogin() {
      return this.credentials;
    },
    async findById() {
      return this.byId;
    },
    async recordLogin(_clinicId, userId, at) {
      loggedIn.push({ userId, at });
    },
    async save(user) {
      saved.push(user);
    },
  };
}

interface FakeSessions extends SessionRepository {
  readonly saved: Session[];
  readonly revoked: { tokenHash: string; at: string }[];
  stored?: Session;
}

function fakeSessions(): FakeSessions {
  const saved: Session[] = [];
  const revoked: { tokenHash: string; at: string }[] = [];
  return {
    saved,
    revoked,
    async save(session) {
      saved.push(session);
    },
    async findByTokenHash() {
      return this.stored;
    },
    async revoke(tokenHash, at) {
      revoked.push({ tokenHash, at });
    },
  };
}

function deps(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    users: fakeUsers(),
    sessions: fakeSessions(),
    passwordHasher: plainHasher,
    tokenGenerator: fixedTokenGenerator,
    clock: fixedClock(),
    ids: sequentialIds(),
    ...overrides,
  };
}

/** The message a refused attempt carries, so two refusals can be compared. */
async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
    throw new Error('expected the attempt to be refused');
  } catch (error) {
    if (error instanceof DomainError) {
      return error.message;
    }
    throw error;
  }
}

describe('login', () => {
  it('issues a session and records the login when the password matches', async () => {
    const users = fakeUsers();
    users.credentials = { user: activeUser(), passwordHash: 'plain:secret' };
    const sessions = fakeSessions();

    const result = await login(
      CLINIC,
      { email: 'admin@clinic.test', password: 'secret' },
      deps({ users, sessions }),
    );

    expect(result.token).toBe('token-abc');
    expect(result.user.email).toBe('admin@clinic.test');
    // The stored row carries the hash, never the token.
    expect(sessions.saved).toHaveLength(1);
    expect(sessions.saved[0]?.tokenHash).toBe('hash(token-abc)');
    expect(sessions.saved[0]?.tokenHash).toBe(fixedTokenGenerator.hashToken(result.token));
    expect(sessions.saved[0]?.clinicId).toBe(CLINIC);
    expect(users.loggedIn).toEqual([{ userId: USER_ID, at: '2026-10-22T10:00:00.000Z' }]);
  });

  it('expires the session twelve hours after issue by default', async () => {
    const users = fakeUsers();
    users.credentials = { user: activeUser(), passwordHash: 'plain:secret' };
    const sessions = fakeSessions();

    const result = await login(
      CLINIC,
      { email: 'admin@clinic.test', password: 'secret' },
      deps({ users, sessions }),
    );

    expect(result.expiresAt).toBe('2026-10-22T22:00:00.000Z');
  });

  it('refuses an unknown email and a wrong password with the same error', async () => {
    const unknown = fakeUsers();
    const wrong = fakeUsers();
    wrong.credentials = { user: activeUser(), passwordHash: 'plain:secret' };

    const unknownAttempt = login(
      CLINIC,
      { email: 'nobody@clinic.test', password: 'secret' },
      deps({ users: unknown }),
    );
    const wrongAttempt = login(
      CLINIC,
      { email: 'admin@clinic.test', password: 'guess' },
      deps({ users: wrong }),
    );

    await expect(unknownAttempt).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(wrongAttempt).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const unknownError = await refusal(unknownAttempt);
    const wrongError = await refusal(wrongAttempt);
    // Indistinguishable: the endpoint must not reveal which accounts exist.
    expect(unknownError).toBe(wrongError);
  });

  it('refuses a deactivated account even with the right password', async () => {
    const users = fakeUsers();
    users.credentials = { user: activeUser({ isActive: false }), passwordHash: 'plain:secret' };

    await expect(
      login(CLINIC, { email: 'admin@clinic.test', password: 'secret' }, deps({ users })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a user with no stored password hash', async () => {
    const users = fakeUsers();
    users.credentials = { user: activeUser() };

    await expect(
      login(CLINIC, { email: 'admin@clinic.test', password: 'secret' }, deps({ users })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('resolvePrincipal', () => {
  function storedSession(overrides: Partial<Session> = {}): Session {
    return {
      id: 'session-1',
      tokenHash: 'hash(token-abc)',
      userId: USER_ID,
      clinicId: CLINIC,
      issuedAt: '2026-10-22T10:00:00.000Z' as IsoDateTime,
      expiresAt: '2026-10-22T22:00:00.000Z' as IsoDateTime,
      ...overrides,
    };
  }

  it('returns the principal for a live session on an active user', async () => {
    const sessions = fakeSessions();
    sessions.stored = storedSession();
    const users = fakeUsers();
    users.byId = activeUser();

    const principal = await resolvePrincipal(CLINIC, 'token-abc', deps({ users, sessions }));

    expect(principal).toEqual({ userId: USER_ID, clinicId: CLINIC, role: 'ADMINISTRATOR' });
  });

  it('refuses a missing, revoked or expired session', async () => {
    const missing = deps({ sessions: fakeSessions() });

    const revoked = fakeSessions();
    revoked.stored = storedSession({ revokedAt: '2026-10-22T11:00:00.000Z' as IsoDateTime });

    const expired = fakeSessions();
    expired.stored = storedSession({ expiresAt: '2026-10-22T09:00:00.000Z' as IsoDateTime });

    await expect(resolvePrincipal(CLINIC, 'token-abc', missing)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      resolvePrincipal(CLINIC, 'token-abc', deps({ sessions: revoked })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      resolvePrincipal(CLINIC, 'token-abc', deps({ sessions: expired })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a token that belongs to another clinic', async () => {
    const sessions = fakeSessions();
    sessions.stored = storedSession({ clinicId: OTHER_CLINIC });

    await expect(resolvePrincipal(CLINIC, 'token-abc', deps({ sessions }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('refuses when the user has since been deactivated', async () => {
    const sessions = fakeSessions();
    sessions.stored = storedSession();
    const users = fakeUsers();
    users.byId = activeUser({ isActive: false });

    await expect(
      resolvePrincipal(CLINIC, 'token-abc', deps({ users, sessions })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses when the user no longer exists', async () => {
    const sessions = fakeSessions();
    sessions.stored = storedSession();

    await expect(resolvePrincipal(CLINIC, 'token-abc', deps({ sessions }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('logout', () => {
  it('revokes the session by hash at the current instant', async () => {
    const sessions = fakeSessions();

    await logout('token-abc', {
      sessions,
      tokenGenerator: fixedTokenGenerator,
      clock: fixedClock(),
    });

    expect(sessions.revoked).toEqual([
      { tokenHash: 'hash(token-abc)', at: '2026-10-22T10:00:00.000Z' },
    ]);
  });
});

describe('session helpers', () => {
  it('compares expiry as an instant', () => {
    const session: Session = {
      id: 's',
      tokenHash: 'h',
      userId: USER_ID,
      clinicId: CLINIC,
      issuedAt: '2026-10-22T10:00:00.000Z' as IsoDateTime,
      expiresAt: '2026-10-22T22:00:00.000Z' as IsoDateTime,
    };

    expect(isSessionExpired(session, '2026-10-22T21:59:59.000Z' as IsoDateTime)).toBe(false);
    expect(isSessionExpired(session, '2026-10-22T22:00:00.000Z' as IsoDateTime)).toBe(true);
  });

  it('treats a nullish session as unusable and an active user as fine', () => {
    expect(() => assertSessionUsable(undefined, '2026-10-22T10:00:00.000Z' as IsoDateTime)).toThrow(
      DomainError,
    );
    expect(() => assertUserActive(activeUser())).not.toThrow();
  });
});
