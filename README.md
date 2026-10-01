# Denti-Code U3

A modern dental clinic management system for **Web** and **Desktop**.

> **Phase 1 — Architecture / Foundation.**
> This repository currently contains the technical foundation only: architecture
> documentation, ADRs, the monorepo, tooling, the domain model, the database
> foundation, minimal runnable web/desktop/API shells, and the test foundation.
> It is intentionally **not** a working product yet. See
> [`docs/roadmap.md`](./docs/roadmap.md).

## Principle

```
ONE REACT APPLICATION · ONE DOMAIN · TWO DEPLOYMENT TARGETS · ONE DATABASE STRATEGY
```

Web and desktop ship the same React application; both talk to the same REST API;
PostgreSQL is the only database (no SQLite, no offline sync — yet).

## Repository map

```
apps/
  api/       Node + Fastify + TypeScript REST API (owns all DB access)
  web/       Browser deployment shell (Vite)
  desktop/   Tauri 2 deployment shell (Vite + src-tauri)
packages/
  app/       THE single React application (routes, providers, features, styles)
  ui/        Design system: tokens + shadcn/ui primitives
  domain/    Framework-independent dental domain (pure TypeScript)
  api-client/ Typed REST client
  types/     Shared types/enums
  validation/ Zod schemas for every system boundary
  config/    Shared tooling config (tsconfig, eslint, prettier, vitest, tailwind)
  tsconfig/  Base TypeScript configs
database/
  schema/ migrations/ seeds/
e2e/         Playwright specs
docs/        Architecture, domain, ADRs, roadmap, progress
scripts/     check-boundaries.mjs (architecture guard)
```

## Getting started

```bash
# pnpm is required (v10). If missing: npm i -g pnpm --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"

pnpm install
cp .env.example .env          # then adjust DATABASE_URL if needed

pnpm run db:up                # PostgreSQL in Docker (host port 5433)
pnpm run db:migrate           # apply Drizzle migrations
pnpm run db:seed              # development data

pnpm run dev:web              # http://localhost:5173
pnpm run dev:api              # http://localhost:3000
pnpm run dev:desktop          # Tauri window
```

## Commands

| Command                                                          | Purpose                                    |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `pnpm build`                                                     | Build everything (Turbo)                   |
| `pnpm typecheck`                                                 | `tsc --noEmit` in every package            |
| `pnpm lint`                                                      | ESLint (includes the architecture guard)   |
| `pnpm format` / `pnpm format:check`                              | Prettier                                   |
| `pnpm test`                                                      | Vitest unit + component tests              |
| `pnpm test:integration`                                          | Database integration tests (needs `db:up`) |
| `pnpm test:e2e`                                                  | Playwright (needs browsers + build)        |
| `pnpm guard:boundaries`                                          | Architectural dependency rules             |
| `pnpm db:up` / `db:down` / `db:migrate` / `db:seed` / `db:reset` | Database                                   |

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — system architecture and layers
- [`docs/domain.md`](./docs/domain.md) — domain model, entities, lifecycles
- [`docs/frontend.md`](./docs/frontend.md) — React application architecture
- [`docs/backend.md`](./docs/backend.md) — REST API architecture
- [`docs/database.md`](./docs/database.md) — PostgreSQL + Drizzle
- [`docs/desktop.md`](./docs/desktop.md) — Tauri 2 strategy
- [`docs/testing.md`](./docs/testing.md) — testing architecture
- [`docs/security.md`](./docs/security.md) — security baseline (**no compliance
  claims**)
- [`docs/open-questions.md`](./docs/open-questions.md) — questions needing product
  input
- [`docs/roadmap.md`](./docs/roadmap.md) — the 12 milestones
- [`docs/decisions/`](./docs/decisions) — architecture decision records
- [`AGENTS.md`](./AGENTS.md) — working agreement and session protocol

## Contribution rules (non-negotiable)

See `AGENTS.md`. The short version: no business logic or database access in
components; no Drizzle/React/Tauri/Postgres in the domain; server state lives in
TanStack Query and local state in Zustand; significant decisions get an ADR; the
architecture guard must pass.
