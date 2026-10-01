# ADR 0001 — Use a pnpm + Turborepo monorepo

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** repository layout, CI, dependency management

## Context

Denti-Code U3 must ship one product to two targets (web + desktop) that share
their entire application and domain code, plus a backend API and a database
schema. The pieces must be developed, versioned and released together; a
change to an API contract or to a shared domain rule has to land in the
frontend and the API atomically. There is no legacy codebase, no migration
constraint and no second team that needs independent repositories.

Options considered:

1. Multi-repo (web, desktop, api, packages) with Git submodules or private npm
   packages.
2. Nx / Nx-style plugin monorepo.
3. pnpm workspaces + Turborepo (chosen).
4. A single app repo with folder-based boundaries only.

## Decision

Use a **pnpm workspace + Turborepo monorepo**. Every deployable or shared unit
is a workspace package:

- `apps/*` — deployables: `web`, `desktop`, `api`.
- `packages/*` — shared libraries: `app`, `ui`, `domain`, `api-client`,
  `types`, `validation`, `config`, `tsconfig`.
- `database/` — schema, migrations, seeds (owned by the API at runtime).
- `e2e/` — Playwright specs.
- `docs/` — architecture, ADRs, roadmap, progress.

`turbo.json` defines the task graph (`build`, `typecheck`, `lint`, `test`,
`format:check`, `db:*`) with explicit `dependsOn` so builds are incremental and
cached.

## Rationale

- **Atomic cross-cutting changes.** A domain rule and the API that enforces it
  and the UI that displays it change in one commit, with one typecheck. This is
  the single strongest argument: cross-package type safety is the main defect
  class in a polyglot client/server codebase.
- **One dependency resolution.** pnpm's strict, isolated node_modules prevents
  phantom dependencies (a package cannot import something it did not declare),
  which is what makes the boundary guard meaningful.
- **One toolchain.** One ESLint flat config, one Prettier config, one TypeScript
  base config, one `pnpm test` for everything. No "works on my repo" drift.
- **Cacheable CI.** Turborepo caches task output keyed by inputs+dependencies.
- **Low ceremony.** pnpm workspaces is the least opinionated option available;
  we keep full control of the build graph instead of adopting a plugin-heavy
  framework (Nx) whose conventions we would fight.

## Consequences

Positive:

- Dependency direction can be _enforced_ mechanically
  (`scripts/check-boundaries.mjs`, `pnpm run guard:boundaries`).
- Deployables stay thin; shared code has exactly one home.
- Adding the future mobile target means adding one package, not a repo.

Negative / accepted costs:

- Contributors must understand the workspace layout — mitigated by `AGENTS.md`
  and `CONTRIBUTING`-style onboarding notes in `docs/frontend.md`.
- Cross-package builds require the task graph to be correct; a wrong
  `dependsOn` produces stale builds. Mitigated by explicit `^build` deps and by
  `outputs` declarations.
- Turborepo is a build orchestrator, not a framework: it does not enforce
  boundaries by itself. We enforce them with our own guard script instead of
  adopting a plugin system we do not need.

## Alternatives rejected

- **Multi-repo:** versioning pain, contract drift between API and clients,
  cross-repo atomic changes impossible. Rejected.
- **Nx:** heavier, plugin-driven conventions, more opinionated than needed for
  a greenfield product with a small surface. Rejected for now; the monorepo can
  be migrated to Nx later without changing package boundaries.
- **Single package with folders:** makes it trivially easy to violate
  boundaries (any folder can import any folder), provides no isolation, and
  cannot host the Tauri Rust crate or the Node API cleanly. Rejected.

## Verification

`pnpm install` at the root installs every workspace; `pnpm run build`,
`pnpm run typecheck`, `pnpm run lint`, `pnpm run test` fan out through Turbo.
