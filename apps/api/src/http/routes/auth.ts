/**
 * Authentication endpoints: log in, log out, and "who am I".
 *
 * The route is thin by design — it validates the body, calls the use case, and
 * shapes the reply. Every rule (wrong password, deactivated account, expiry) lives
 * in the domain use case. The bearer token is returned in the **response body**,
 * not a cookie, so the same mechanism works for the browser, the desktop shell and
 * an integration, and CSRF is not part of the story (ADR 0028).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError, login, logout, type AuthDependencies } from '@denti-code-u3/domain';
import { loginSchema } from '@denti-code-u3/validation';
import type { ClinicId } from '@denti-code-u3/types';

import type { LoginRateLimiter } from '../../infrastructure/security/login-rate-limiter.js';
import { sendProblem } from '../problem.js';

export interface AuthRoutesDependencies {
  readonly auth: AuthDependencies;
  /** The clinic this process serves; login is scoped to it. */
  readonly clinicId: string;
  /** Counts failed attempts per email and client address (ADR 0029). */
  readonly loginRateLimiter: LoginRateLimiter;
}

/**
 * The limiter's unit: who tried, from where.
 *
 * Including the address means one shared clinic terminal exhausting its attempts
 * does not lock the account out for a clinician on another machine, and a
 * successful sign-in clears only the key that succeeded.
 */
function rateLimitKey(email: string, clientAddress: string): string {
  return `${email.trim().toLowerCase()}|${clientAddress}`;
}

function readBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  { auth, clinicId, loginRateLimiter }: AuthRoutesDependencies,
): Promise<void> {
  /**
   * Log in. Public by declaration: a login endpoint that required a session would
   * be unreachable, and the `public: true` flag is what keeps this explicit rather
   * than a rule the auth hook has to special-case by path.
   */
  app.post('/api/v1/auth/login', { config: { public: true } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The email or password is missing or malformed',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    const key = rateLimitKey(parsed.data.email, request.ip);
    const decision = loginRateLimiter.check(key);
    if (!decision.allowed) {
      // No email in the log line: the key belongs to a person, the fact of a
      // refusal is what an operator investigating an attack needs.
      request.log.warn(
        { requestId: request.id, clientAddress: request.ip },
        'Login refused by rate limiter',
      );
      reply.header('retry-after', String(decision.retryAfterSeconds));
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many sign-in attempts. Try again later.',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await login(clinicId as ClinicId, parsed.data, auth);
      loginRateLimiter.recordSuccess(key);
      return reply.status(200).send({
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      });
    } catch (error) {
      // Only a refused credential counts; a database outage or a bug must not
      // punish the person trying to sign in.
      if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') {
        loginRateLimiter.recordFailure(key);
      }
      return sendProblem(reply, request, error, 'Login failed');
    }
  });

  /** Log out. Authenticated, so the token to revoke is the one presented. */
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = readBearerToken(request);
    try {
      if (token) {
        await logout(token, auth);
      }
      return reply.status(204).send();
    } catch (error) {
      return sendProblem(reply, request, error, 'Logout failed');
    }
  });

  /**
   * The current principal, for a client restoring a session on load.
   *
   * It answers from `request.principal`, which the auth hook already resolved, so
   * this makes no second session read and cannot disagree with the guard that let
   * the request through.
   */
  app.get('/api/v1/auth/me', async (request, reply) => {
    const user = await auth.users.findById(request.clinicId as ClinicId, request.principal.userId);
    if (!user) {
      // The session resolved a moment ago, so a missing user is a race with a
      // deletion; treat it as the session no longer being valid.
      return reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'The account no longer exists',
          requestId: request.id,
        },
      });
    }

    return { user, expiresAt: null };
  });
}
