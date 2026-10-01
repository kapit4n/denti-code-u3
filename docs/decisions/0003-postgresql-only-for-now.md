# ADR 0003 — PostgreSQL only, no SQLite, no offline sync in this phase

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** database strategy, desktop architecture, roadmap

## Context

It is tempting to give the desktop application a local database so that the
clinic keeps working during an internet outage. That would mean **two**
persistence systems, a conflict-resolution strategy, a sync engine, and roughly
doubled data-modelling surface — from day one, for a product whose first
milestones are a dashboard and an agenda.

The brief is explicit: PostgreSQL is the only database for now; SQLite, offline
mode and sync are out of scope; the architecture must merely _not make future
offline impossible_.

## Decision

- **PostgreSQL is the only database.** No SQLite, no local desktop database, no
  in-memory dev database standing in for it, no offline mode, no sync engine, no
  queue.
- **The desktop application talks to the same REST API as the browser.** It has
  no direct database connection of any kind (guard rule 4).
- **Persistence is reached only through repository interfaces** owned by
  `packages/domain`, implemented with Drizzle in `apps/api`. This is the seam
  that keeps a future local repository possible _without writing it now_.
- **No speculative abstractions are added** "just in case": there is no
  `SyncEngine`, no `Outbox`, no conflict resolver, no `LocalRepository`. Only
  the repository ports that the current PostgreSQL architecture genuinely needs.

## Rationale

- **Correctness over resilience, early.** Clinical data is not something to
  duplicate across stores while the product model is still moving. One source of
  truth means no sync bugs, no conflict UI, no reconciliation.
- **The repository port already gives the extension point.** The future diagram

  ```
  Application → RepositoryInterface → { ServerRepository → PostgreSQL
                                      { LocalRepository  → SQLite (future)
                                        + future sync engine
  ```

  only requires _implementing_ the existing interfaces later. Nothing in the
  domain or the API needs to change to make room for it, because the domain
  never learns which repository it got.

- **PostgreSQL is the right tool** for this domain: transactional integrity for
  billing, strong constraints, `timestamptz` for timezone-correct scheduling,
  JSONB for flexible clinical payloads, `pg_trgm` for fast patient search, and
  first-class indexing for agenda range queries.
- **Cost of being wrong is low.** If offline is later required, the ports are
  already in place; we would add a repository and a sync engine — weeks of work,
  not a rewrite.

## Consequences

Positive:

- One database to run, back up, migrate and reason about.
- No dual-write bugs, no "works offline / broken online" states.
- Faster delivery of the first real milestones (shell, dashboard, patients).

Negative / accepted costs:

- The desktop app is unusable without connectivity. **Accepted for now**,
  documented as a product limitation in `docs/desktop.md` and
  `docs/open-questions.md`.
- Clinic data is not on the local machine, so local backup/export is not
  possible (later milestone).
- A future offline phase is real work (conflict resolution on appointments and
  payments especially). We have not paid for it in advance and we have not
  pretended it is free.

## Alternatives rejected

- **SQLite on desktop + sync now:** rejected by the brief; doubles the
  modelling and test surface before the product model is understood.
- **Electron/Postgres-only but API in the desktop process:** rejected — it would
  give the UI process database credentials, violating guard rules 3 and 4.
- **An ORM-agnostic abstraction over both databases now:** rejected as a
  premature abstraction (rule 18).

## Verification

- `pnpm run guard:boundaries` fails if anything outside `apps/api` and
  `database/` imports `drizzle-orm`/`postgres`, or if `packages/domain` imports
  any infrastructure.
- The only database dependency in the repo is `postgres` (postgres.js) used by
  `apps/api/src/infrastructure/persistence/postgres/*` and the migration
  runner.
- `docker-compose.yml` provides the only PostgreSQL instance used in
  development.
