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

Web E2E (Playwright) against the built app:

1. **App startup** — the shell loads, the dashboard route renders.
2. **Dashboard navigation** — navigating the sidebar reaches each route.
3. **Patient search** — global search finds a patient by name/phone.
4. **Appointment lifecycle** — create → confirm → arrive → in treatment →
   completed (and cancel / no-show paths).
5. **Visit workspace** — open a visit from an appointment, add a clinical note.
6. **Agenda** — day/week/month views render; filters by dentist/chair apply.

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
