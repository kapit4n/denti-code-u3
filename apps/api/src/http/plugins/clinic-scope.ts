/**
 * Clinic scope for the request lifecycle.
 *
 * ADR 0014 requires every clinical read and write to be scoped to a clinic, and
 * forbids inferring that scope from global state inside a repository. This
 * module is the *only* place allowed to turn ambient information (today:
 * `CLINIC_ID` from configuration; later: an authenticated session) into the
 * explicit `clinicId` argument that repositories and use cases receive.
 *
 * Doing it here rather than in each route handler means:
 *
 *  - a handler physically cannot forget to scope a query, because the only
 *    clinic id on `request` is the resolved one;
 *  - swapping the resolution strategy for real authentication later touches
 *    this file and nothing else;
 *  - the single-clinic assumption is written down once instead of being spread
 *    across every `WHERE` clause as a hard-coded constant.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ApiConfig } from '../../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The clinic this request may read and write. Present on every route
     * registered after this plugin; never re-inferred downstream.
     */
    clinicId: string;
  }
}

export interface ClinicScopeOptions {
  readonly config: ApiConfig;
}

/**
 * Resolve the clinic for one request.
 *
 * Today this is the configured clinic, because authentication does not exist yet
 * and there is no user whose clinic membership could be checked. When auth
 * lands, this function must verify that the caller belongs to the resolved
 * clinic instead of trusting configuration alone — tracked in
 * `docs/open-questions.md`.
 */
function resolveClinicId(options: ClinicScopeOptions): string {
  return options.config.clinicId;
}

export async function registerClinicScope(
  app: FastifyInstance,
  options: ClinicScopeOptions,
): Promise<void> {
  app.decorateRequest('clinicId', '');
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.clinicId = resolveClinicId(options);
  });
}
