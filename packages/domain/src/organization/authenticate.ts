/**
 * Authentication use cases — login, session resolution and logout.
 *
 * These are the only places a password is verified, a session is issued, or a
 * session is turned back into a principal. They are pure orchestration over the
 * ports: read the user, verify the password, mint a token, store its hash. The
 * rules they enforce are the ones a login screen must never be trusted to:
 *
 *  - **A wrong password and an unknown email are the same refusal.** Both throw
 *    `UNAUTHENTICATED` with the same message, so the endpoint cannot be used to
 *    enumerate who has an account.
 *  - **A deactivated user cannot log in,** even with the right password.
 *  - **The stored token is a hash.** The plain token is returned once, in the
 *    login result, and the database knows only the hash.
 *
 * No HTTP, no cookie, no header: the transport picks those. The result is data.
 */

import type { ClinicId, IsoDateTime, UserId } from '@denti-code-u3/types';

import type { SessionRepository, UserRepository } from '../ports/index.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/id-generator.js';
import type { PasswordHasher, TokenGenerator } from '../shared/security.js';
import { DomainError } from '../shared/errors.js';
import {
  assertSessionUsable,
  assertUserActive,
  isSessionExpired,
  principalFromUser,
  type AuthenticatedUser,
  type Principal,
  type Session,
} from '../organization/auth.js';

/** Session lifetime, in hours. A working day, so a shift does not require re-login. */
export const DEFAULT_SESSION_TTL_HOURS = 12;

export interface AuthDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly tokenGenerator: TokenGenerator;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly sessionTtlHours?: number;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginResult {
  /** The plain bearer token. Returned exactly once; never stored in this form. */
  readonly token: string;
  readonly expiresAt: IsoDateTime;
  readonly user: AuthenticatedUser;
}

/**
 * The one message every failed login produces.
 *
 * Deliberately not parameterised by reason: "no such email", "wrong password"
 * and "deactivated" must be indistinguishable to a caller, or the endpoint hands
 * an attacker a list of valid accounts.
 */
const LOGIN_REFUSED_MESSAGE = 'The email or password is incorrect';

function addHours(iso: IsoDateTime, hours: number): IsoDateTime {
  const base = new Date(iso);
  base.setUTCHours(base.getUTCHours() + hours);
  return base.toISOString() as IsoDateTime;
}

/**
 * Verify credentials and issue a session.
 *
 * `findByEmailForLogin` decides existence; the hasher decides the password; the
 * domain decides whether the account may log in at all. Every branch that is not
 * a complete success collapses to the same refusal.
 */
export async function login(
  clinicId: ClinicId,
  input: LoginInput,
  dependencies: AuthDependencies,
): Promise<LoginResult> {
  const { users, sessions, passwordHasher, tokenGenerator, clock, ids } = dependencies;
  const now = clock.now();

  const found = await users.findByEmailForLogin(clinicId, input.email);

  // A user with no stored hash cannot be verified. That is a refusal, not an
  // error: an invited-but-unprovisioned account is unknown for login purposes.
  if (!found || found.passwordHash === undefined) {
    throw new DomainError('UNAUTHENTICATED', LOGIN_REFUSED_MESSAGE);
  }

  const passwordMatches = await passwordHasher.verify(input.password, found.passwordHash);
  if (!passwordMatches) {
    throw new DomainError('UNAUTHENTICATED', LOGIN_REFUSED_MESSAGE);
  }

  // Checked after the password, not before, so a deactivated account is
  // indistinguishable from a wrong password to someone guessing.
  const user = assertUserActive(found.user);

  const token = tokenGenerator.nextToken();
  const session: Session = {
    id: ids.nextId(),
    tokenHash: tokenGenerator.hashToken(token),
    userId: user.id,
    clinicId,
    issuedAt: now,
    expiresAt: addHours(now, dependencies.sessionTtlHours ?? DEFAULT_SESSION_TTL_HOURS),
  };

  await sessions.save(session);
  await users.recordLogin(clinicId, user.id, now);

  return { token, expiresAt: session.expiresAt, user };
}

/**
 * Turn a presented token into a principal, or refuse.
 *
 * Looks the session up by hash, then applies the domain's own usability rules
 * (not revoked, not expired) and the user's active flag. A deactivated user's
 * existing session stops working here, which is the only place revocation can be
 * enforced once a token is out in the world.
 */
export async function resolvePrincipal(
  clinicId: ClinicId,
  token: string,
  dependencies: AuthDependencies,
): Promise<Principal> {
  const { users, sessions, tokenGenerator, clock } = dependencies;

  const session = await sessions.findByTokenHash(tokenGenerator.hashToken(token));
  const usable = assertSessionUsable(session, clock.now());

  // The session names a clinic; a token from another clinic is not valid here.
  // This is what makes the single-clinic process safe by construction rather
  // than by every route remembering to check.
  if (usable.clinicId !== clinicId) {
    throw new DomainError('UNAUTHENTICATED', 'The session does not belong to this clinic');
  }

  const user = await users.findById(clinicId, usable.userId);
  if (!user) {
    throw new DomainError('UNAUTHENTICATED', 'The account no longer exists');
  }

  return principalFromUser(assertUserActive(user));
}

/** Revoke the presented session. Idempotent and silent: logging out twice is fine. */
export async function logout(
  token: string,
  dependencies: Pick<AuthDependencies, 'sessions' | 'tokenGenerator' | 'clock'>,
): Promise<void> {
  await dependencies.sessions.revoke(
    dependencies.tokenGenerator.hashToken(token),
    dependencies.clock.now(),
  );
}

export { isSessionExpired, type AuthenticatedUser, type Principal, type Session, type UserId };
