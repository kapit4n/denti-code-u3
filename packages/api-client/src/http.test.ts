/**
 * The API client is the boundary every feature talks through, so its tests are
 * about the *contract* with the API: query serialisation, the error envelope,
 * schema validation and timeouts.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiClient, ApiClientError, buildQueryString, toApiClientError } from './http.js';

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/**
 * `vi.fn` infers an empty parameter list from a bare arrow function, which makes
 * `mock.calls[0]` untyped. Typing the mock as `typeof fetch` keeps the call
 * assertions honest and lets TypeScript check the arguments the client passed.
 */
type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

/** `fetch` is overloaded, so the mock is built through a cast rather than a
 * narrower signature that would not be assignable to it. */
function fetchMock(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchMock {
  return vi.fn(handler as unknown as typeof fetch);
}

function clientWith(fetchImplementation: typeof fetch, timeoutMs = 15_000) {
  return new ApiClient({
    baseUrl: 'http://api.test/api/v1/',
    fetchImplementation,
    defaultTimeoutMs: timeoutMs,
  });
}

describe('buildQueryString', () => {
  it('returns an empty string when there is nothing to send', () => {
    expect(buildQueryString()).toBe('');
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString({ a: undefined, b: null })).toBe('');
  });

  it('skips empty values so an unset filter is not sent as an empty filter', () => {
    expect(buildQueryString({ search: '', page: 1, active: false })).toBe('?page=1&active=false');
  });

  it('serialises booleans and zero, which are values and not absences', () => {
    expect(buildQueryString({ active: false, offset: 0 })).toBe('?active=false&offset=0');
  });

  it('encodes values that need it', () => {
    expect(buildQueryString({ q: 'a b&c=d' })).toBe('?q=a+b%26c%3Dd');
  });
});

describe('ApiClient requests', () => {
  it('joins the base URL and path without doubling the slash', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ ok: true }));
    const client = clientWith(fetchImpl);

    await client.get('/patients');

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/patients');
  });

  it('sends the bearer token when one is available', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ ok: true }));
    const client = new ApiClient({
      baseUrl: 'http://api.test/api/v1',
      fetchImplementation: fetchImpl,
      getAuthorizationHeader: () => 'Bearer token-123',
    });

    await client.get('/patients');

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer token-123');
  });

  it('serialises a JSON body and sets the content type', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ id: '1' }));
    const client = clientWith(fetchImpl);

    await client.post('/patients', { firstName: 'Ana' });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"firstName":"Ana"}');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('sends PUT for a replacement, not PATCH for a merge', async () => {
    // The verb is the contract: the patient endpoint reads a missing field as
    // "clear it". A client quietly sending PATCH would leave a corrected-away
    // email in the database, which no test above would catch.
    const fetchImpl = fetchMock(async () => new Response(null, { status: 204 }));
    const client = clientWith(fetchImpl);

    await client.put('/patients/1', { firstName: 'Ana', lastName: 'García' });

    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe('{"firstName":"Ana","lastName":"García"}');
  });

  it('returns undefined for 204 instead of trying to parse a body', async () => {
    const fetchImpl = fetchMock(async () => new Response(null, { status: 204 }));
    const client = clientWith(fetchImpl);

    await expect(client.delete('/patients/1')).resolves.toBeUndefined();
  });

  it('turns an unreachable API into a NETWORK_ERROR with the URL for diagnosis', async () => {
    const fetchImpl = fetchMock(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = clientWith(fetchImpl);

    const error = await client
      .get('/patients')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    const apiError = error as ApiClientError;
    expect(apiError.code).toBe('NETWORK_ERROR');
    expect(apiError.status).toBe(0);
    expect(apiError.details.url).toBe('http://api.test/api/v1/patients');
  });
});

describe('ApiClient response validation', () => {
  it('passes a response that matches the schema', async () => {
    const schema = z.object({ id: z.uuid(), firstName: z.string() });
    const fetchImpl = fetchMock(async () =>
      jsonResponse({ id: '11111111-1111-4111-8111-111111111111', firstName: 'Ana' }),
    );
    const client = clientWith(fetchImpl);

    const result = await client.get('/patients/1', { schema });

    expect(result).toEqual({ id: '11111111-1111-4111-8111-111111111111', firstName: 'Ana' });
  });

  it('rejects a drifted contract with the issues attached', async () => {
    const schema = z.object({ id: z.uuid() });
    const fetchImpl = fetchMock(async () => jsonResponse({ id: 'not-a-uuid' }));
    const client = clientWith(fetchImpl);

    const error = await client
      .get('/patients/1', { schema })
      .then(() => null)
      .catch((caught: unknown) => caught as ApiClientError | null);

    expect(error).not.toBeNull();
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(error?.details.issues)).toBe(true);
  });
});

describe('toApiClientError', () => {
  it('reads the documented error envelope', async () => {
    const response = jsonResponse(
      {
        error: {
          code: 'SCHEDULING_CONFLICT',
          message: 'The dentist is already booked',
          details: { conflictingAppointmentId: 'abc' },
          requestId: 'req-7',
        },
      },
      { status: 409 },
    );

    const error = await toApiClientError(response);

    expect(error.code).toBe('SCHEDULING_CONFLICT');
    expect(error.status).toBe(409);
    expect(error.requestId).toBe('req-7');
    expect(error.details.conflictingAppointmentId).toBe('abc');
  });

  it('falls back safely when the body is not JSON', async () => {
    const response = new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' });

    const error = await toApiClientError(response);

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(502);
  });

  it('does not trust an unknown error code from the server', async () => {
    const response = jsonResponse(
      { error: { code: 'TOTALLY_MADE_UP', message: 'nope' } },
      { status: 400 },
    );

    const error = await toApiClientError(response);

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(400);
  });
});
