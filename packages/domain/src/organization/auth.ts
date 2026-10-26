/**
 * Authentication and authorization — the pure rules.
 *
 * This module owns the vocabulary of "who is calling, what may they do" without
 * knowing anything about HTTP, cookies, tokens, hashing or databases. A session
 * here is a fact — this user, for this clinic, with this role, valid until this
 * instant — and the only rules are the ones a clinic can state out loud:
 *
 *  - a deactivated user cannot hold a valid session, whatever their token says;
 *  - a session past its expiry is no session at all;
 *  - a role either carries a permission or it does not (`hasPermission`).
 *
 * The password is deliberately absent. Hashing and verification are an
 * infrastructure concern (`PasswordHasher` in the ports), because they depend on
 * a crypto library the domain must not import (ADR 0004). The domain carries a
 * **stored hash**, never a password, and never compares two of them itself.
 */

import type { ClinicId, IsoDateTime, UserId } from '@denti-code-u3/types';

import type { ClinicRole } from './roles.js';
import { DomainError } from '../shared/errors.js';

/** A person who logs in to the clinic. One user belongs to exactly one clinic. */
export interface AuthenticatedUser {
  readonly id: UserId;
  readonly clinicId: ClinicId;
  readonly email: string;
  readonly fullName: string;
  readonly role: ClinicRole;
  readonly isActive: boolean;
  readonly lastLoginAt?: IsoDateTime;
}

/**
 * A user plus the hash needed to verify a password.
 *
 * Kept separate from `AuthenticatedUser` on purpose: the hash is read once, at
 * login, and never travels with the user afterwards. A type that carried it
 * everywhere would be one `JSON.stringify` away from leaking it.
 */
export interface UserWithCredentials {
  readonly user: AuthenticatedUser;
  /**
   * The stored password hash, or `undefined` for a user who has never been given
   * a password. A user with no hash cannot log in and is refused exactly like a
   * wrong password — the API does not disclose which accounts exist.
   */
  readonly passwordHash?: string;
}

/**
 * A session as the domain sees it.
 *
 * `tokenHash` is the hash of the bearer token, never the token itself: the
 * database stores what a leaked dump cannot be replayed with. The plain token
 * exists only in the login response and the caller's memory.
 */
export interface Session {
  readonly id: string;
  readonly tokenHash: string;
  readonly userId: UserId;
  readonly clinicId: ClinicId;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
}

/**
 * The authenticated caller, as the request lifecycle needs it.
 *
 * This is what an auth plugin hands downstream: the user, the clinic they are
 * acting in (their own membership) and their role. Routes never read a cookie or
 * a token — they receive this.
 */
export interface Principal {
  readonly userId: UserId;
  readonly clinicId: ClinicId;
  readonly role: ClinicRole;
}

export function principalFromUser(user: AuthenticatedUser): Principal {
  return { userId: user.id, clinicId: user.clinicId, role: user.role };
}

/** Whether an instant is strictly before a session's expiry. */
export function isSessionExpired(session: Session, now: IsoDateTime): boolean {
  // ISO-8601 UTC strings compare correctly as text: same length, same zone,
  // most-significant field first. Parsing to `Date` for a comparison that a
  // string already answers would only add a failure mode.
  return session.expiresAt <= now;
}

/**
 * Decide whether a session still stands at `now`.
 *
 * Refusals carry no detail beyond "not authenticated" so a caller cannot learn
 * whether a token was unknown, revoked or simply old — every one of those is the
 * same instruction: log in again.
 */
export function assertSessionUsable(session: Session | undefined, now: IsoDateTime): Session {
  if (!session || session.revokedAt !== undefined || isSessionExpired(session, now)) {
    throw new DomainError('UNAUTHENTICATED', 'The session is missing, revoked or expired');
  }
  return session;
}

/** A user must be active to be authenticated at all. */
export function assertUserActive(user: AuthenticatedUser): AuthenticatedUser {
  if (!user.isActive) {
    throw new DomainError('UNAUTHENTICATED', 'The account is not active');
  }
  return user;
}
