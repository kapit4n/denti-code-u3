/**
 * Authentication for the request lifecycle.
 *
 * This plugin replaces the config-based clinic lookup that stood in for
 * authentication (ADR 0014's `clinic-scope.ts`) with a real one. It runs on
 * `onRequest` and does exactly three things:
 *
 *  1. read the `Authorization: Bearer <token>` header;
 *  2. turn the token into a `Principal` through the `resolvePrincipal` use case,
 *     which is where expiry, revocation and the user's active flag are decided;
 *  3. put the resolved clinic and principal on the request.
 *
 * **Every route is authenticated by default.** A route that must be reachable
 * without a session (health, the login endpoint itself) declares that with
 * `config: { public: true }`, and this hook skips it. The alternative — protecting
 * routes one by one — fails open: a new route that forgets the guard is public,
 * and nobody notices until a report is filed. Failing closed means a forgotten
 * route is simply unreachable, which is loud and safe.
 *
 * No route ever reads the header, the token or the session. They read
 * `request.clinicId` (unchanged) and `request.principal`. That is what keeps the
 * session model in one file and the routes free of it.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AuthDependencies,
  ClinicRole,
  ClinicPermission,
  Principal,
} from '@denti-code-u3/domain';
import { hasPermission } from '@denti-code-u3/domain';
import type { ClinicId } from '@denti-code-u3/types';

import type { ApiConfig } from '../../config/env.js';
import { resolvePrincipal } from '@denti-code-u3/domain';
import { DomainError } from '@denti-code-u3/domain';
import { sendProblem } from '../problem.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The clinic this request may read and write. Present on every authenticated route. */
    clinicId: string;
    /** The authenticated caller. Present on every authenticated route. */
    principal: Principal;
  }

  interface FastifyContextConfig {
    /** `true` on routes reachable without a session. Nothing else is public. */
    public?: boolean;
    /**
     * The permission(s) the caller's role must carry to reach this route. Declared
     * on the route so the requirement sits next to the path it protects, and
     * enforced by this plugin before the handler runs. Omitted only on routes that
     * any authenticated user may call (the session's own endpoints).
     */
    permission?: ClinicPermission | readonly ClinicPermission[];
  }
}

export interface AuthPluginOptions {
  readonly config: ApiConfig;
  readonly auth: AuthDependencies;
}

/** The scheme a client must present. Case-insensitive, per RFC 7235. */
function readBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}

export async function registerAuth(
  app: FastifyInstance,
  options: AuthPluginOptions,
): Promise<void> {
  // Decorated with placeholders so the types are non-optional; the hook below
  // fills them for every non-public route before any handler runs. `null` is cast
  // because Fastify's decorator runtime accepts a value of the declared type or a
  // getter, and there is no `Principal` until a request resolves one.
  app.decorateRequest('clinicId', '');
  app.decorateRequest('principal', null as unknown as Principal);

  app.addHook('onRequest', async (request, reply) => {
    // No matched route: the answer is 404, and it must not depend on whether the
    // caller happens to hold a token. This also keeps a route that exists only in
    // development (ADR 0030) answering 404 in production rather than 401, which
    // would look like an expired session to the client.
    if (request.routeOptions.url === undefined) {
      return;
    }

    if (request.routeOptions.config.public === true) {
      return;
    }

    const token = readBearerToken(request);
    if (!token) {
      // A 401 with `WWW-Authenticate` is the standard "present credentials".
      reply.header('www-authenticate', 'Bearer');
      return sendProblem(
        reply,
        request,
        new DomainError('UNAUTHENTICATED', 'Authentication is required'),
        'Missing bearer token',
      );
    }

    try {
      const principal = await resolvePrincipal(
        options.config.clinicId as ClinicId,
        token,
        options.auth,
      );
      request.principal = principal;
      request.clinicId = principal.clinicId;
    } catch (error) {
      reply.header('www-authenticate', 'Bearer');
      return sendProblem(reply, request, error, 'Resolving the session failed');
    }

    // Authorization, after authentication: an authenticated caller whose role
    // lacks the route's declared permission gets 403, not 401. Declaring the
    // permission on the route rather than inside the handler means a handler
    // cannot forget it — there is nothing in the handler to forget.
    const required = request.routeOptions.config.permission;
    if (required !== undefined) {
      assertPermission(request.principal, ...(Array.isArray(required) ? required : [required]));
    }
  });
}

/**
 * Refuse the request unless the caller's role carries every named permission.
 *
 * Called at the top of a handler, not as a route guard, so the requirement sits
 * next to the code it protects and is visible in the same scroll. `FORBIDDEN`
 * (403) is the answer for an authenticated caller who lacks the permission, which
 * is deliberately different from the 401 an unauthenticated caller gets: one says
 * "log in", the other says "you cannot do this".
 */
export function assertPermission(principal: Principal, ...permissions: ClinicPermission[]): void {
  const missing = permissions.filter((permission) => !hasPermission(principal.role, permission));
  if (missing.length > 0) {
    throw new DomainError('FORBIDDEN', 'The role may not perform this action', {
      role: principal.role satisfies ClinicRole,
      required: permissions,
      missing,
    });
  }
}
