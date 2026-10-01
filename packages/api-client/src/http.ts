/**
 * The typed REST client for the Denti-Code U3 API.
 *
 * Framework-free on purpose: the same client is used by the React application,
 * by tests and by any future client (mobile, integrations). It knows nothing
 * about React, TanStack Query or the browser.
 */

import { ZodError, type ZodType } from 'zod';
import { apiErrorResponseSchema } from '@denti-code-u3/validation';

/** Stable, machine-readable error codes shared with the API error envelope. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'DOMAIN_RULE_VIOLATION',
  'SCHEDULING_CONFLICT',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;

  readonly status: number;

  readonly details: Readonly<Record<string, unknown>>;

  /** Echoed by the API; the user quotes it, support finds the log line. */
  readonly requestId?: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ ...details });
    this.requestId = requestId;
  }
}

export interface ApiClientOptions {
  /** Base URL including the version prefix, e.g. `http://localhost:3000/api/v1`. */
  readonly baseUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImplementation?: typeof fetch;
  /** Injected per request, typically a bearer token from the session. */
  readonly getAuthorizationHeader?: () => string | undefined;
  readonly defaultTimeoutMs?: number;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions<TBody> {
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: TBody;
  readonly schema?: ZodType;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClient {
  private readonly baseUrl: string;

  private readonly fetchImplementation: typeof fetch;

  private readonly getAuthorizationHeader?: () => string | undefined;

  private readonly defaultTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.getAuthorizationHeader = options.getAuthorizationHeader;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async get<TResponse>(path: string, options: RequestOptions<never> = {}): Promise<TResponse> {
    return this.request('GET', path, options);
  }

  async post<TResponse, TBody>(
    path: string,
    body: TBody,
    options: RequestOptions<TBody> = {},
  ): Promise<TResponse> {
    return this.request('POST', path, { ...options, body });
  }

  async patch<TResponse, TBody>(
    path: string,
    body: TBody,
    options: RequestOptions<TBody> = {},
  ): Promise<TResponse> {
    return this.request('PATCH', path, { ...options, body });
  }

  async delete<TResponse>(path: string, options: RequestOptions<never> = {}): Promise<TResponse> {
    return this.request('DELETE', path, options);
  }

  /**
   * Every request validates its response against a Zod schema when one is
   * supplied. An API change therefore fails in development with a readable
   * mismatch instead of surfacing as `undefined is not an object` in a component.
   */
  private async request<TResponse>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: RequestOptions<unknown>,
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${path}${buildQueryString(options.query)}`;
    const headers = new Headers({ accept: 'application/json' });
    const authorization = this.getAuthorizationHeader?.();
    if (authorization) {
      headers.set('authorization', authorization);
    }
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    const timeout = AbortSignal.timeout(this.defaultTimeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal,
      });
    } catch (cause) {
      throw new ApiClientError('NETWORK_ERROR', 'The Denti-Code U3 API could not be reached', 0, {
        url,
        reason: cause instanceof Error ? cause.message : 'unknown',
      });
    }

    if (!response.ok) {
      throw await toApiClientError(response);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const payload = await response.json();
    if (!options.schema) {
      return payload as TResponse;
    }

    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError(
        'VALIDATION_ERROR',
        'The API returned a response that does not match the expected contract',
        response.status,
        {
          issues: parsed.error.issues,
          requestId: response.headers.get('x-request-id') ?? undefined,
        },
      );
    }
    return parsed.data as TResponse;
  }
}

export async function toApiClientError(response: Response): Promise<ApiClientError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new ApiClientError(
      'INTERNAL_ERROR',
      response.statusText || 'Request failed',
      response.status,
    );
  }

  const parsed = apiErrorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return new ApiClientError(
      'INTERNAL_ERROR',
      'The API returned an unexpected error response',
      response.status,
    );
  }

  const { code, message, details, requestId } = parsed.data.error;
  return new ApiClientError(
    isApiErrorCode(code) ? code : 'INTERNAL_ERROR',
    message,
    response.status,
    details ?? {},
    requestId,
  );
}

function isApiErrorCode(value: string): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(value);
}

export function buildQueryString(query?: Readonly<Record<string, QueryValue>>): string {
  if (!query) {
    return '';
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : '';
}

export { ZodError };
