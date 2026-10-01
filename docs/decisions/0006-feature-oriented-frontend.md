# ADR 0006 — Feature-oriented frontend, one component library package

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `packages/app`, `packages/ui`, contribution workflow

## Context

The product will contain at least ten feature areas (dashboard, agenda,
patients, visits, odontogram, treatments, payments, inventory, reports,
settings). A conventional layout with a single global `components/` directory
and a global `hooks/` directory degrades predictably: it becomes a junk drawer,
feature boundaries blur, and nobody can change a feature without risking the
whole app. Conversely, over-fragmenting shared primitives into dozens of tiny
packages makes refactoring expensive.

The brief is explicit: feature-oriented architecture; no giant global
components directory; shared visual primitives in `packages/ui`; business rules
in `packages/domain`; API communication in `packages/api-client`.

## Decision

Inside `packages/app`, organise by **feature**, each feature self-contained:

```
packages/app/src/features/patients/
├── api/            use cases that call packages/api-client
├── queries/        TanStack Query options + query-key factories
├── mutations/      invalidation-aware mutations
├── components/     presentation components for this feature only
├── hooks/          feature hooks (composition only)
├── stores/         Zustand stores, if this feature needs local UI state
├── routes/         route definitions for /patients…
├── schemas.ts      Zod form schemas (feature-scoped)
└── index.ts        PUBLIC ENTRY POINT — the only importable path
```

Rules:

- A feature imports other features **only** through their `index.ts`.
- Components shared by 2+ features live in `packages/ui` (primitives) or in
  `packages/app/src/shared/` (composed, app-level pieces such as the page frame,
  data-state wrappers, the global search dialog).
- "Shared" is not a dumping ground: it only holds things that are genuinely
  cross-feature _and_ not primitives. The rule of thumb is "if it renders one
  domain concept, it belongs to a feature".
- One component per file, named after the domain concept
  (`PatientSearchForm`, not `Form`, not `SearchForm3`).
- Colocation of tests next to code (`*.test.tsx` next to the component).

## Rationale

- **Locality.** Everything about patients lives in one directory; deleting or
  rewriting a feature does not require archaeology across the repo.
- **Boundaries are enforceable.** Public entry points plus the ESLint
  `no-restricted-imports` rule for deep feature paths mean a feature cannot be
  silently coupled to another feature's internals.
- **Scales with the product.** Ten features in ten directories stays
  comprehensible; ten features scattered across a global `components/` folder
  does not.
- **Business rules stay out of the UI.** Because rules live in
  `packages/domain` and are imported by feature `api/`, components remain
  presentation + orchestration only (architecture rule 1).
- **`packages/ui` remains a genuine design system**: tokens plus shadcn/ui
  primitives, with no feature or domain imports, so it can be reasoned about as a
  coherent visual language (see ADR 0010).

## Consequences

Positive:

- Parallel work on different features touches disjoint directories.
- Feature removal is a directory delete plus a route-table edit.
- A reviewer can understand a feature by reading one directory.
- `packages/ui` has a crisp meaning: "the visual language of Denti-Code".

Negative / accepted costs:

- **Some components will start life duplicated** inside two features and be
  promoted to `shared`/`ui` only once a third use appears. Accepted: premature
  abstraction is explicitly forbidden (rule 18); duplication is cheaper than the
  wrong abstraction.
- **Discipline is required** to keep `shared/` small. Mitigation: a lint rule
  bans generic directory names, and the review checklist in `AGENTS.md` asks
  "does a domain name exist for this?".
- **Feature public entry points must be maintained** — adding new exports to
  `index.ts` is part of "finishing" a feature.

## Alternatives rejected

- **Global `components/` + `hooks/` directories:** the junk-drainer failure mode
  the brief warns against. Rejected.
- **One package per feature (10 workspace packages):** maximum isolation, but 10
  packages × N releases for a monolith that changes together; excessive build
  and versioning ceremony. Rejected.
- **Pure vertical slices inside `apps/web`:** rejected because the desktop app
  must import the same code — the application must live in a workspace package
  both shells can depend on (ADR 0008).
- **Micro-frontends:** irrelevant at this size.

## Verification

- ESLint bans imports of `features/**/!(index)`.
- `pnpm run guard:boundaries` checks that `packages/ui` imports nothing from
  `packages/app` or `packages/domain`.
- Every feature exposes exactly one `index.ts`.
