/**
 * Development-only doors for testing: list the clinic's users and start a session
 * as one of them without a password (ADR 0030).
 *
 * These routes are **not registered in production** — `buildServer` adds them only
 * when `NODE_ENV` is not `production`, so there is no flag a deployment can leave
 * on and no handler to forget to guard. They are public because the whole point is
 * to be reachable before a session exists.
 *
 * The list is the safe projection (`AuthenticatedUser`), never the credential
 * read, so a password hash cannot travel through the chooser. The domain still
 * refuses an unknown or inactive user; this door skips the password, not the
 * account rules.
 */

import type { FastifyInstance } from 'fastify';
import { startSessionForUser, type AuthDependencies } from '@denti-code-u3/domain';
import { devLoginSchema } from '@denti-code-u3/validation';
import type { ClinicId, UserId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface DevAuthRoutesDependencies {
  readonly auth: AuthDependencies;
  /** The clinic this process serves; the chooser lists only its users. */
  readonly clinicId: string;
}

export async function registerDevAuthRoutes(
  app: FastifyInstance,
  { auth, clinicId }: DevAuthRoutesDependencies,
): Promise<void> {
  app.get('/api/v1/auth/dev-users', { config: { public: true } }, async () => {
    const users = await auth.users.listByClinic(clinicId as ClinicId);
    return { items: users.filter((user) => user.isActive) };
  });

  app.post('/api/v1/auth/dev-login', { config: { public: true } }, async (request, reply) => {
    const parsed = devLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A user id is required',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const userId = parsed.data.userId as UserId;
      const result = await startSessionForUser(clinicId as ClinicId, userId, auth);
      request.log.warn({ requestId: request.id, userId }, 'Development sign-in used');
      return reply.status(200).send({
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      });
    } catch (error) {
      return sendProblem(reply, request, error, 'Development login failed');
    }
  });
}
