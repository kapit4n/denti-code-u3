/**
 * Mock API for the end-to-end specs.
 *
 * One handler, matching the whole `/api` prefix, looks the requested pathname up
 * in a fixture map and answers 501 for anything it does not recognise. Three
 * properties of that design are load-bearing, and each was learned the hard way
 * during Milestone 4.
 *
 * 1. **One handler, not one per endpoint.** Playwright runs the most recently
 *    registered matching route first, which makes per-endpoint handlers silently
 *    order-dependent. A single dispatcher has no ordering to get wrong, so
 *    calling `installApi` twice in one spec reconfigures rather than conflicts.
 *
 * 2. **Lookup by method and pathname, never by pattern.** A route registered for
 *    the path `/api/v1/patients` does not match a request to that path carrying a
 *    query string, so a glob-shaped mock silently misses every real request. It
 *    is worse than useless in that case: the specs still passed, because a real
 *    API happened to be running on port 3010 and answered them. A spec that
 *    quietly talks to a live database is not a spec, it is a coin flip.
 *
 *    The method is part of the key because `GET /patients` and `POST /patients`
 *    are different endpoints that share a path. Keying on the path alone meant a
 *    registration spec's POST was answered with the list fixture, and the spec
 *    failed for a reason that had nothing to do with what it was testing.
 *
 * 3. **Unknown endpoints get a loud 501 naming the path.** The app was fully
 *    typechecked, linted, built and green while `VITE_API_URL` was missing its
 *    `/api/v1` prefix, so every request 404ed and nothing noticed. Here a request
 *    to `/api/patients` fails with "no fixture for /api/patients", which points
 *    straight at the base URL. That is also why the handler matches all of `/api`
 *    rather than only `/api/v1`: a narrower pattern would let the regression
 *    through to the network, which is the bug this file exists to catch.
 */

import type { Page, Route } from '@playwright/test';

/**
 * A fixture, or an explicit failure.
 *
 * `body` is deliberately **required**, even though every field of a JSON payload
 * is optional. With `body?: unknown` any object at all satisfies `Fixture`, so
 * passing a bare payload where a fixture belongs — `anaProfile` instead of
 * `{ body: anaProfile }` — typechecks cleanly and then serves `{}` at runtime,
 * because the dispatcher read `.body` off an object that had none. That mistake
 * was made while writing these specs and cost a confusing debugging detour.
 * Requiring `body` turns it into a compile error instead.
 *
 * Note that Playwright does not typecheck: it transpiles specs with esbuild. The
 * only thing standing between a bad fixture and a green-looking run is
 * `pnpm run typecheck`.
 */
export interface Fixture {
  readonly status?: number;
  readonly body: unknown;
}

/**
 * Fixtures keyed by `'/api/v1/patients'` or by `'POST /api/v1/patients'`.
 *
 * A bare path answers any method, which is what the read-only specs want. Prefix
 * with a method to answer only that one.
 */
export type MockedResponses = Readonly<Record<string, Fixture>>;

/** One request the app made, recorded for assertions. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  /** Parsed JSON body, or `undefined` for a request without one. */
  readonly body: unknown;
}

interface ApiState {
  readonly fixtures: Map<string, Fixture>;
  readonly requests: string[];
  readonly recorded: RecordedRequest[];
  /** Status used for any path with no fixture. 501 unless overridden. */
  fallbackStatus: number;
}

export interface InstalledApi {
  /**
   * Every requested URL, in order, query string included.
   *
   * Full URLs rather than pathnames because "did the search term reach the
   * server?" is a question only the query string can answer.
   */
  readonly requests: string[];
  /** Method, URL and body of every request, for payload assertions. */
  readonly recorded: readonly RecordedRequest[];
}

const states = new WeakMap<Page, ApiState>();

async function ensureRouted(page: Page): Promise<ApiState> {
  const existing = states.get(page);
  if (existing) {
    return existing;
  }

  const state: ApiState = {
    fixtures: new Map(),
    requests: [],
    recorded: [],
    fallbackStatus: 501,
  };
  states.set(page, state);

  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method().toUpperCase();
    state.requests.push(url.href);

    const rawBody = route.request().postData();
    let body: unknown;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        // Not JSON. Left as `undefined` rather than throwing: a spec asserting
        // on a body should fail its own expectation, not the mock's plumbing.
      }
    }
    state.recorded.push({ method, url: url.href, body });

    // Method-specific fixture first, then the path-only fallback.
    const fixture =
      state.fixtures.get(`${method} ${url.pathname}`) ?? state.fixtures.get(url.pathname);
    if (fixture) {
      await route.fulfill({
        status: fixture.status ?? 200,
        contentType: 'application/json',
        // Serialised per request: `fulfill` keeps a reference to the body, so a
        // spec that mutates its fixture afterwards would change what the page
        // receives on the next call.
        body: JSON.stringify(fixture.body ?? {}),
      });
      return;
    }

    await route.fulfill({
      status: state.fallbackStatus,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'NO_FIXTURE',
          // The whole point: name the path, so a wrong base URL is obvious in
          // the failure report instead of looking like a generic 404.
          message: `No API fixture for ${url.pathname}`,
          requestId: 'e2e',
        },
      }),
    });
  });

  return state;
}

/**
 * Registers (or replaces) fixtures for this page and returns the request log.
 *
 * Safe to call more than once per page: each call reconfigures the one shared
 * handler rather than adding a competing route.
 */
export async function installApi(page: Page, responses: MockedResponses): Promise<InstalledApi> {
  const state = await ensureRouted(page);

  for (const [key, fixture] of Object.entries(responses)) {
    state.fixtures.set(key, fixture);
  }

  return { requests: state.requests, recorded: state.recorded };
}

/** Makes every endpoint on the page fail, replacing any fixtures already set. */
export async function installApiFailure(page: Page, status = 500): Promise<InstalledApi> {
  const state = await ensureRouted(page);
  state.fixtures.clear();
  state.fallbackStatus = status;
  return { requests: state.requests, recorded: state.recorded };
}

export function notFound(): Fixture {
  return {
    status: 404,
    body: {
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'e2e' },
    },
  };
}
