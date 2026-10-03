# Denti-Code U3 — Testing Architecture

Testing conventions are established in the foundation phase so that later
milestones do not have to retrofit them.

---

## 1. Layers

| Layer                  | What it covers                                                                 | Where                                                         | Runs on                                     |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| **Unit — domain**      | business rules, state machines, value objects, money math, odontogram validity | `packages/domain/src/**/*.test.ts`                            | every `pnpm test`                           |
| **Unit — application** | use cases with in-memory repository fakes                                      | `apps/api/src/application/**/*.test.ts`                       | every `pnpm test`                           |
| **Unit — validation**  | Zod schemas and env parsing                                                    | `packages/validation/**/*.test.ts`, `apps/api/src/config`     | every `pnpm test`                           |
| **Unit — adapters**    | calendar mapping, api-client URL/parsing, platform fakes                       | `packages/app/src/**/*.test.ts(x)`, `packages/api-client`     | every `pnpm test`                           |
| **Component**          | important UI interactions, design-system primitives                            | `packages/app/src/**/*.test.tsx`, `packages/ui/**/*.test.tsx` | every `pnpm test`                           |
| **Integration — API**  | routes via `fastify.inject()`, error envelope, validation, authz               | `apps/api/test/**/*.test.ts`                                  | every `pnpm test`                           |
| **Integration — DB**   | repositories and migrations against real PostgreSQL                            | `apps/api/test/persistence`, `database`                       | `pnpm test:integration` (needs `db:up`)     |
| **E2E — web**          | critical user journeys in the browser                                          | `e2e/web/**/*.spec.ts`                                        | `pnpm test:e2e` (needs Playwright browsers) |
| **E2E — desktop**      | desktop shell strategy (see §6)                                                | `e2e/desktop`                                                 | manual/strategy documented                  |

## 2. Tools

- **Vitest** — unit, component and integration tests. One workspace config, three
  projects (node / react / api) so jsdom is only used where DOM is needed.
- **React Testing Library + user-event** — component behaviour, driven through
  the DOM the way a user interacts.
- **Playwright** — E2E against the built web app (preview server).
- **Fake timers / injected `Clock`** — deterministic time in domain and use-case
  tests. No reliance on `Date.now()` mocking.

## 3. Conventions

- Test files are colocated with source: `appointment-status.test.ts` next to
  `appointment-status.ts`. Integration/E2E tests live in the test directories
  above.
- Naming: `<subject>.<what is asserted>` — e.g.
  `appointment-status: allows Scheduled → Arrived but not Completed → Scheduled`.
- **Arrange / Act / Assert** with blank lines between the phases.
- One behavioural assertion cluster per test; a test name states the rule, not
  the function name.
- **No snapshots for domain or API contracts** — assert explicit values.
  Snapshots are acceptable only for stable visual structures.
- Fakes are named after the port they implement (`InMemoryPatientRepository`),
  never `mockData`/`stub2`.
- Tests must be deterministic: no real clock, no network, no filesystem (except
  DB integration, which uses the docker PostgreSQL).

## 4. Domain tests (the highest-value tests)

Domain rules are pure functions, so these tests are fast and comprehensive. The
foundation phase seeds them for:

- appointment status machine (every legal/illegal transition)
- appointment end time + chair/dentist overlap detection
- visit state machine and the appointment→visit bridge
- invoice totals, discounts, tax, patient balance (integer money)
- odontogram FDI notation and condition validity
- treatment-plan progress projection
- role → permission mapping
- clinic-day boundaries in a timezone

These are the tests that protect clinical and financial correctness, and they are
the reason the domain is framework-independent.

## 5. API integration tests

- Build the Fastify app through the composition root (`container.ts`) so tests
  exercise the same wiring as production.
- Use `app.inject()` — no port binding, no network.
- Inject in-memory repository fakes (or the real repositories against the test
  database, marked accordingly).
- Assert the error envelope shape (`{ error: { code, message, requestId } }`) and
  that internal errors never leak SQL/stack.

## 6. Database integration tests

- Require a running PostgreSQL (`pnpm run db:up`); otherwise the suite is skipped
  with a clear message (never silently passed).
- Apply migrations to a test database, run repository tests against it, then
  reset.
- These tests are what verify Drizzle schema ↔ migrations ↔ domain mapping.

## 7. E2E strategy

Web E2E (Playwright) against the **built** app served by `vite preview`:

1. **Shell smoke** (`web/smoke.spec.ts`) — the shell loads and the shared frame
   mounts. This is the layer that catches a route tree which compiles but does
   not mount.
2. **Dashboard** (`web/dashboard.spec.ts`) — every metric matches the payload
   verbatim, and an _unknown_ figure (`occupancyRate: null`) is presented as
   unknown rather than as `0%`.
3. **Patients** (`web/patients.spec.ts`) — list, search, profile and header
   search, including the empty, error and not-found paths.

Appointment lifecycle, visit workspace and agenda specs arrive with Milestones
5–6.

### The API is mocked, by default

`web/fixtures/mock-api.ts` intercepts every `/api/**` request and answers from a
fixture map keyed by **exact pathname**. Three properties of that are
load-bearing:

- **One handler, not one per endpoint.** Playwright runs the most recently
  registered matching route first, so per-endpoint handlers are silently
  order-dependent. A single dispatcher has no ordering to get wrong.
- **Lookup by pathname, never by glob.** A route registered for
  `/api/v1/patients` does _not_ match a request carrying a query string, so a
  glob-shaped mock silently misses every real request. It is worse than useless
  then: the specs still pass, because some other server answers them.
- **Unknown endpoints get a loud 501 naming the path.** A request to
  `/api/patients` — the signature of `VITE_API_URL` missing its `/api/v1`
  prefix — fails with `No API fixture for /api/patients`. Matching all of `/api`
  rather than only `/api/v1` is what makes that catchable.

Fixtures are frozen copies of real responses (`web/fixtures/api-responses.ts`),
so specs stay deterministic and `pnpm run test:e2e` needs no database, like the
unit suite. The API's own behaviour is covered against real PostgreSQL in
`apps/api/test/*.integration.test.ts`; the e2e layer does not duplicate it.

### Two traps worth remembering

- **Playwright does not typecheck.** It transpiles specs with esbuild, so a
  malformed fixture reaches the browser instead of failing the build. That is why
  `Fixture.body` is a _required_ property: with `body?: unknown` any object
  satisfies the type, passing a bare payload where a fixture belongs typechecks
  cleanly and then serves `{}`.
- **A spec must not be able to pass for the wrong reason.** Assertions are made
  against values that are deliberately unlike the development seed data, and
  panels are scoped to their own card — a page-wide `getByText('Ana García')`
  matches the appointments panel _and_ Recent Patients, so it passes even when
  the panel is empty.

Every spec in this layer was checked by reintroducing the defect it guards and
confirming it fails. A spec nobody has seen fail is a guess.

Desktop E2E strategy (documented, not fully automated in Phase 1):

- The desktop shell renders the same application; the highest-value checks are
  "the app boots in the Tauri window" and "no Tauri API is used on the web
  path".
- Full desktop E2E automation (WebDriver/`tauri-driver`) is deferred; it adds CI
  complexity disproportionate to its value at this stage. The Playwright project
  is scoped to web, and the desktop build is verified by building it.

## 8. Coverage expectations

- `packages/domain`: **100% of rule modules** (this is the correctness core and
  is cheap to test).
- `packages/validation`: every exported schema must have at least a valid/invalid
  pair.
- Components: behaviour, not coverage percentage.
- No global coverage gate in Phase 1; a threshold is set once the codebase has
  real features (Milestone 12).

## 9. CI order of operations

```
install → lint (incl. boundary guard) → typecheck → unit/component tests
       → db:up → migrations → integration tests → build → e2e (web)
```

Database-dependent steps are separate jobs so a missing database fails loudly
instead of skipping silently.

## 10. Commands

```bash
pnpm test                 # unit + component (Vitest projects)
pnpm test:integration     # DB integration (requires db:up)
pnpm test:e2e             # Playwright web E2E (requires browsers + build)
pnpm run guard:boundaries # architectural dependency rules
```
