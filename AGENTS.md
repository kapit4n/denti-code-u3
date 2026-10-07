# AGENTS.md — Working Agreement for Denti-Code U3

> This file is the **durable memory** of this project. Read it FIRST, before any
> other file, every time you start working on Denti-Code U3 — including after a
> context reset, a new session, or a disconnect.
> Update it and `docs/progress/STATE.md` at the end of every work session.

---

## 1. What this product is

**DENTI-CODE U3** — a modern dental clinic management system.

- Target platforms: **Web** and **Desktop**
- It is a **NEW PRODUCT**. It is not a migration of anything.
- Stack: React 19 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack (Router,
  Query, Table) + Zustand + RHF + Zod + FullCalendar + Recharts + Lucide,
  Tauri 2 for desktop, Node + TypeScript REST API, PostgreSQL + Drizzle ORM,
  pnpm + Turborepo monorepo, Vitest + RTL + Playwright.
- Monorepo, ONE domain, TWO deployment targets, ONE database strategy
  (PostgreSQL only, for now).

## 2. Current phase

**PHASE 1 — ARCHITECTURE / FOUNDATION (in progress).**

The goal of this phase is _only_ the technical foundation: architecture docs,
ADRs, monorepo, tooling, domain model boundaries, database foundation,
minimal runnable web/desktop/API, test foundation.

**Explicitly NOT in scope right now** (do not implement, even if it looks
tempting):

- complete patient CRUD
- complete appointment CRUD
- complete dashboard / calendar / odontogram / billing / inventory / reports
- complete authentication
- offline mode, SQLite, sync engine, local desktop DB
- microservices, GraphQL, Redux

See `docs/roadmap.md` for the milestone sequence.

## 3. The 25 non-negotiable architectural rules

1. No business logic in React components.
2. No database access in React components.
3. No direct PostgreSQL access from React.
4. No direct PostgreSQL access from Tauri.
5. No scattered Tauri API calls in React (use the platform abstraction).
6. No Drizzle imports in the domain.
7. No React imports in the domain.
8. No PostgreSQL-specific logic in the domain.
9. No giant Zustand store.
10. No global API-data store.
11. No circular dependencies between packages.
12. No giant generic utility directory.
13. No microservices. 14. No GraphQL. 15. No Redux. 16. Two engines, one set
    of ports: **SQLite runs everything by default**, PostgreSQL is retained as a
    second engine (ADR 0025). A schema change lands in `database/schema` _and_
    `database/schema/sqlite`; a new repository method is written twice. Never a
    third database, and never an abstraction over the two.
14. No offline synchronization.
15. No premature abstractions.
16. Prefer explicit dependencies. 20. Prefer simple solutions.
17. Keep features independently understandable.
18. Keep business rules framework-independent.
19. Keep infrastructure replaceable.
20. Document significant decisions (ADR in `docs/decisions/`).
21. Naming must be domain-specific — never `data`, `stuff`, `helpers`, `misc`,
    `common2`, `manager`, `service2`. Prefer `PatientRepository`,
    `CreateAppointment`, `SearchPatients`, `GetPatient`, `CreateVisit`.

There is an automated guard for the dependency-direction rules:
`pnpm run guard:boundaries` (see `scripts/check-boundaries.mjs`).

## 4. Repository map

```
apps/
  api/       Node.js + Fastify + TypeScript REST API (owns all DB access)
  web/       Browser deployment shell (Vite + index.html + main.tsx)
  desktop/   Tauri 2 deployment shell (Vite + src-tauri + main.tsx)
packages/
  app/       THE single React application (routes, providers, shell wiring)
  ui/        Design system: tokens + shadcn/ui primitives
  domain/    Framework-independent dental domain (pure TypeScript)
  api-client/ Typed REST client used by web + desktop + app
  types/     Shared TS types/enums shared by all runtimes
  validation/ Zod schemas used at every system boundary
  config/    Shared tooling config (tsconfig, eslint, prettier, vitest, tailwind)
  tsconfig/  Base TS configs (extends into every package)
database/
  schema/    Drizzle schema (one file per bounded area)
  migrations/ Generated SQL migrations + journal
  seeds/     Development seed data
e2e/         Playwright specs (web smoke + desktop strategy)
docs/        Architecture, domain, ADRs, roadmap, progress
```

Dependency direction (inward only):

```
Presentation (apps/web, apps/desktop, packages/app, packages/ui)
    -> Application (application use cases + queries live with the feature)
        -> Domain (packages/domain)
Infrastructure (apps/api + Drizzle repositories, REST transport)
```

`packages/domain` MUST NOT import react, browser APIs, Tauri, Postgres,
Drizzle, TanStack Query, Zustand, or UI components.

## 5. Working style (mandatory)

1. Inspect → 2. Understand → 3. Identify constraints → 4. Design →
2. Document decisions → 6. Implement the smallest necessary foundation →
3. Verify (typecheck, lint, format, build, tests, boots) → 8. Report.

- Never silently introduce a major architectural decision: write an ADR.
- When something is ambiguous: make the simplest reasonable assumption,
  document it, and mark it as **OPEN QUESTION** if product input is needed.
- Do not invent product requirements. Do not over-engineer.
- Priority order: maintainability > clear boundaries > DX > testability >
  consistent UI architecture > web/desktop reuse > future extensibility.

## 6. Commands (always use pnpm from the workspace root)

```bash
pnpm install
pnpm run build            # turbo build all
pnpm run typecheck        # tsc --noEmit everywhere
pnpm run lint             # eslint everywhere
pnpm run format           # prettier --write .
pnpm run format:check
pnpm run test             # vitest unit/component tests
pnpm run test:e2e         # playwright (needs browsers installed)
pnpm run guard:boundaries # architectural dependency rules
pnpm run db:up | db:down  # start/stop local PostgreSQL (docker)
pnpm run db:migrate       # apply drizzle migrations
pnpm run db:seed          # seed development data
pnpm run dev:web          # Vite dev server
pnpm run dev:api          # API dev server
pnpm run dev:desktop      # Tauri dev app
```

## 7. Session protocol (IMPORTANT — survives context loss)

At the **start** of a session:

1. Read this file.
2. Read `docs/progress/STATE.md` (current phase, done/pending checklist).
3. Read `docs/roadmap.md` for what the next milestone is.
4. `git status` / inspect the tree before changing anything.

At the **end** of a session:

1. Update the checklist + "Last session log" in `docs/progress/STATE.md`.
2. Update `docs/progress/LOG.md` with what was done and the verification result.
3. Report using the 13-section format in `docs/progress/REPORT_TEMPLATE.md`.

## 8. Environment notes for this machine

- Node v22.23.2, npm 10.9.8.
- **pnpm is NOT on the default PATH.** It was installed with
  `npm i -g pnpm@10 --prefix "$HOME/.local"`. Run
  `export PATH="$HOME/.local/bin:$PATH"` first (already added to `~/.bashrc`).
- Docker works (29.8.0) → local PostgreSQL runs via `docker compose`.
  Do not touch unrelated containers (e.g. `denti-rabbitmq`).
- Rust toolchain installed via rustup (stable 1.99.0, `~/.cargo`, `--no-modify-path`,
  PATH export appended to `~/.bashrc`). System Tauri deps installed via apt:
  `build-essential libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev
  libayatana-appindicator3-dev librsvg2-dev`. `pnpm run dev:desktop` verified —
  first Rust compile takes ~3 minutes (422 crates, tauri 2.12.1). Desktop dev
  runs on `DISPLAY=:0`; keep the machine limitation note here if this changes.
- esbuild is added to `onlyBuiltDependencies` in `pnpm-workspace.yaml`; pnpm 10
  blocks its postinstall otherwise and Vite/Tauri frontend tooling breaks.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
