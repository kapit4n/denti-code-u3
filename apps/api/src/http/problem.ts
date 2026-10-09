/**
 * The single error envelope for the API.
 *
 * Every failing response is produced here. Unknown failures become a generic 500
 * with a request id and never carry a stack trace, SQL statement or driver
 * message to the client — those are logged server-side instead.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type DomainErrorCode } from '@denti-code-u3/domain';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DOMAIN_RULE_VIOLATION'
  | 'SCHEDULING_CONFLICT'
  | 'DUPLICATED_RECORD'
  | 'INTERNAL_ERROR';

export interface ApiProblem {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
}

/** Domain error codes mapped to their HTTP equivalent. */
const DOMAIN_ERROR_HTTP_STATUS: Record<DomainErrorCode, number> = {
  INVALID_INPUT: 422,
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  SCHEDULING_CONFLICT: 409,
  OUTSIDE_OPERATING_HOURS: 422,
  // 409, like the conflict: the request was well formed and the answer is "not with
  // that resource", which is a "try a different one", not a "correct your syntax".
  UNBOOKABLE_RESOURCE: 409,
  INSUFFICIENT_STOCK: 409,
  DUPLICATED_RECORD: 409,
  FORBIDDEN: 403,
};

export function statusForDomainErrorCode(code: DomainErrorCode): number {
  return DOMAIN_ERROR_HTTP_STATUS[code];
}

/** Client-safe message. Never includes SQL or driver text. */
export function toApiProblem(
  error: unknown,
  requestId?: string,
): { status: number; body: ApiProblem } {
  if (error instanceof DomainError) {
    return {
      status: statusForDomainErrorCode(error.code),
      body: {
        code: toApiErrorCode(error.code),
        message: error.message,
        details: error.details,
        requestId,
      },
    };
  }

  return {
    status: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please quote the request id when reporting it.',
      requestId,
    },
  };
}

export function toApiErrorCode(domainCode: DomainErrorCode): ApiErrorCode {
  if (domainCode === 'SCHEDULING_CONFLICT') {
    return 'SCHEDULING_CONFLICT';
  }
  if (domainCode === 'NOT_FOUND') {
    return 'NOT_FOUND';
  }
  if (domainCode === 'FORBIDDEN') {
    return 'FORBIDDEN';
  }
  if (domainCode === 'DUPLICATED_RECORD') {
    return 'DOMAIN_RULE_VIOLATION';
  }
  if (domainCode === 'INVALID_INPUT' || domainCode === 'OUTSIDE_OPERATING_HOURS') {
    return 'VALIDATION_ERROR';
  }
  return 'DOMAIN_RULE_VIOLATION';
}

/**
 * @param context Names the operation for the server log. Never sent to the
 * client: a 500 says "quote the request id", and which query blew up is the
 * server's problem to answer, not the caller's to be told about.
 */
export function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
  context?: string,
): FastifyReply {
  const requestId = request.id;
  const { status, body } = toApiProblem(error, requestId);

  if (status >= 500) {
    // The detail stays on the server; the client only gets the request id.
    request.log.error(
      { err: error, requestId },
      context ?? 'Unhandled error while serving a request',
    );
  } else {
    request.log.warn({ requestId, code: body.code }, 'Request rejected');
  }

  reply.header('x-request-id', requestId);
  return reply.status(status).send({ error: body });
}
