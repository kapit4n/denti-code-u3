# CURRENT STATE — Denti-Code U3

> Last updated: session 3 (scheduling invariant reconciled with the schema)
> This file is the resume point. Read `AGENTS.md` first, then this file.

## Phase

**PHASE 1 — ARCHITECTURE / FOUNDATION** (Milestone 1 of `docs/roadmap.md`)

**Status: Milestone 1 complete and verified.** Phase 2 (application shell) has not
started.

## Task origin

Single source of truth for the original brief: `docs/progress/BRIEF.md`
(condensed, immutable copy of the 41-section architecture prompt).

## Definition of done for this phase (Milestone 1)

- [x] `docs/architecture.md`, `domain.md`, `frontend.md`, `backend.md`,
      `database.md`, `desktop.md`, `testing.md`, `roadmap.md`, `security.md`,
      `open-questions.md`
- [x] ADRs: 0001 monorepo + pnpm + Turborepo, 0002 Tauri 2 for desktop,
      0003 PostgreSQL only for now, 0004 framework-independent domain,
      0005 REST + Fastify, 0006 feature-oriented frontend,
      0007 TanStack Query vs Zustand, 0008 one React app package with thin
      shells, 0009 platform abstraction, 0010 Tailwind v4 + shadcn design
      system, 0011 FullCalendar as a view adapter, 0012 appointment end time is
      computed and never stored
- [x] pnpm + Turborepo workspace that installs cleanly
- [x] TypeScript strict everywhere (base + per-package configs)
- [x] ESLint (flat config, ESLint 9) + Prettier + boundary guard wired into
      `pnpm run lint`
- [x] `packages/ui`, `domain`, `api-client`, `types`, `validation`, `config`,
      `app`, `tsconfig`
- [x] `apps/api` boots, validates env with Zod, structured logs, `/health`
- [x] `apps/web` builds and serves the shared React app
- [x] `apps/desktop` is a Tauri 2 shell over the same React app
      (frontend build verified; **native Rust build still unverified**)
- [x] PostgreSQL (docker compose) + Drizzle schema + migrations applied, plus
      the appointment overlap exclusion constraints
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
      `pnpm build` all pass
- [x] Vitest + RTL + Playwright foundations present
- [x] `docs/progress/REPORT.md` with the 13-section final report

## Verification log (last run)

| Command                     | Result                                                    |
| --------------------------- | --------------------------------------------------------- |
| `pnpm run typecheck`        | 12/12 tasks pass                                          |
| `pnpm run lint`             | 12/12 tasks pass, `BOUNDARY GUARD OK`                     |
| `pnpm run format:check`     | All files match Prettier                                  |
| `pnpm run test`             | 12/12 tasks, 142 tests pass (5 integration tests skipped) |
| `pnpm run test:integration` | 4/4 pass against real PostgreSQL                          |
| `pnpm run build`            | 5/5 tasks pass                                            |
| `pnpm run db:migrate`       | 2 migrations applied to PostgreSQL 17                     |
| `pnpm run db:generate`      | 23 tables generated                                       |
| API boot                    | `/health` ok, `/ready` reports `database: ok`             |
| Web / desktop build         | Both emit identical CSS with the design tokens present    |

Full detail in `docs/progress/LOG.md`.

## Decisions made this session (not yet in ADRs)

- **API port is 3010, not 3000.** Port 3000 is occupied on this machine by an
  unrelated local Next.js app. `API_PORT`, `VITE_API_URL` and the Zod defaults
  were all changed together so nothing silently points at the wrong service.
- **The appointment end time is computed by an IMMUTABLE SQL function, not
  stored** (ADR 0012). A generated column is impossible (`timestamptz + interval`
  is `STABLE`, not `IMMUTABLE`) and a trigger-maintained column had to stay invisible
  to the Drizzle schema, which made `drizzle-kit push` a threat to the constraint
  protecting the schedule. The exclusion constraints now call
  `appointment_ends_at(starts_at, duration_minutes)`, so there is no stored end
  time to go stale and the schema is the complete physical picture again.
- **ESLint is pinned to 9.39.1.** `eslint-plugin-react@7.37.5` declares a peer of
  ESLint `^9.7` and crashes on ESLint 10 (`contextOrFilename.getFilename is not a
function`). ESLint 10 buys nothing here.
- **The integration database is created by the test run, not by hand.** A wiped
  Docker volume used to mean `test:integration` failed with "database does not
  exist". Vitest `globalSetup` now creates `TEST_DATABASE_URL` if it is missing.
- **The boundary guard reads the import graph, not just manifests.** A manifest
  cannot prove where an import happens, and the previous version silently allowed
  a `@denti-code-u3/tsconfig` dependency. It now scans every source file and
  fails on a forbidden import, a database driver outside the API, or a route file
  inside a deployment shell.

## Open questions

See `docs/open-questions.md`. The Phase 1 question about the hidden `ends_at`
column is **closed** by ADR 0012. Still open:

- **Native Tauri build unverified.** The Rust/Tauri build needs WebKitGTK system
  libraries on Linux. The frontend half of the desktop shell builds and its output
  is byte-identical to the web build, but `tauri build` has not been run.
- **`design-mockup/dashboard-design.png` has not been analysed.** The provisional
  brand palette in `packages/app/src/styles/globals.css` needs to be confirmed
  against the supplied reference before any feature work begins.
- **Clinic-scoped queries are not yet enforced.** Every clinical row carries
  `clinic_id`, but nothing stops a repository from forgetting it. Decided in
  Milestone 2, where the repository shape is designed.

## Next milestone after this phase

**Milestone 2 — APPLICATION SHELL** (sidebar, header, global search, user menu,
routing, responsive layout, theme, shared UI primitives). Dashboard only after.

Concretely, the next session should:

1. Wire TanStack Router into `packages/app` using the generated
   `routeTree.gen.ts`; `apps/web` and `apps/desktop` already point the Vite plugin
   at `packages/app/src/routes`.
2. Add TanStack Query and the `ApiClient` provider using `VITE_API_URL`.
3. Confirm the design tokens against `design-mockup/dashboard-design.png`.
4. Add shadcn/ui primitives to `packages/ui`.

## Last session log

Session 1: started from an empty repository (only a stub `package-lock.json`).
Inspected the machine (Node 22, npm 10, no pnpm on PATH → installed pnpm 10 to
`~/.local`, Docker 29.8 available, cargo 1.97, no psql client). Began Phase 1.

Session 3: resolved the last Phase 1 correctness question. The appointment end
time is now computed by the IMMUTABLE function `appointment_ends_at` and the
hidden `ends_at` column plus its trigger are gone, so the Drizzle schema is again
the exact physical picture of the database — verified by `drizzle-kit generate`
reporting no changes. The migration chain was regenerated as a clean baseline
(`0000_baseline.sql`, `0001_appointment_overlap_guard.sql`). Added ADR 0012, a test
proving a reschedule is re-checked by the constraint, and a Vitest `globalSetup`
that creates the integration database so a wiped Docker volume is one command to
recover from.

Session 2: completed Milestone 1. Implemented the shared React app
(`AppRoot`, platform abstraction, design tokens), the typed API client with 14
tests, the full Drizzle schema (23 tables), the Fastify server with validated
config, redacting structured logs and a single error envelope, the migration and
seed tooling, and the appointment overlap guard as a real PostgreSQL exclusion
constraint proven by 4 integration tests. Rewrote the boundary guard to scan the
import graph. Whole-workspace typecheck, lint, format, tests and build are green.
