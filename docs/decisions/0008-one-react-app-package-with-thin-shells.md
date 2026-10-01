# ADR 0008 — One React application as a shared package, thin platform shells

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `packages/app`, `apps/web`, `apps/desktop`

## Context

The brief's core principle is **one React application, two deployment targets**.
The suggested directory listing puts `apps/web` and `apps/desktop` next to each
other, with the shared libraries in `packages/`. Taken literally, that implies
duplicating or symlinking the React application across two apps — which is
exactly how "the same app" silently forks into two divergent apps.

The requirement is real and non-negotiable: a bug fixed in the agenda must be
fixed for both targets in the same commit, and features must not be able to
diverge.

Options considered:

1. **Full application in `apps/web`; `apps/desktop` builds from it.**
   Vite in `apps/desktop` would have to point its root at another package,
   which fights the workspace model, breaks Tailwind/shadcn conventions and
   makes the desktop build fragile.
2. **Duplicate the app in both apps with copy tooling.** Guaranteed drift; not
   an option.
3. **The React application lives in `packages/app`; `apps/web` and
   `apps/desktop` are thin shells.** (chosen)
4. **A single app package with two build targets configured from it** (no
   `apps/` at all). Loses the explicit deployable boundary and the clear
   per-target build/dev commands.

## Decision

Create `packages/app` — **the** React application — and make `apps/web` and
`apps/desktop` **deployment shells** that contain no features, no routes and no
business logic.

```
packages/app/            THE React application
├── src/
│   ├── app-root.tsx     providers + router
│   ├── routes/          TanStack Router route tree (root route → shell layout)
│   ├── features/        dashboard, agenda, patients, visits, settings (scaffold)
│   ├── shared/          app-level composed pieces (page frame, query state…)
│   ├── platform/        platform abstraction (ADR 0009)
│   ├── styles/          global stylesheet with Tailwind v4 theme + tokens
│   └── query-client.ts  TanStack Query client factory (used by tests)

apps/web/                browser shell
├── index.html
├── vite.config.ts       dev server, port 5173
└── src/main.tsx         mount(<AppRoot/>) + ImportMetaEnv typing

apps/desktop/            Tauri 2 shell — same shape
├── index.html
├── vite.config.ts       fixed port 5174, Tauri-friendly HMR
├── src/main.tsx         mount(<AppRoot/>)   ← identical to web
└── src-tauri/           Rust crate, no SQL, no React
```

Each shell's `main.tsx` is three lines and identical. Neither shell may define a
route, a component, a store or a query. This is enforced by the boundary guard
(guard rule 6).

The application owns the router, the providers (Query, Theme, Platform, Router),
and the route tree; the shell only owns the HTML document and the runtime URL.

## Rationale

- **Literal fulfilment of "one React application".** There is exactly one place
  where the UI exists. Web and desktop cannot diverge because they cannot
  contain code.
- **The shell stays honest.** A shell's only responsibilities are: serve the
  document, set the runtime URL, and (desktop) provide native capabilities. That
  is a genuinely small, understandable surface.
- **Build isolation without source duplication.** Each shell has its own Vite
  config, port, `index.html` and env handling, so the desktop target can have
  Tauri-specific Vite settings without polluting web — while importing the exact
  same application source.
- **The architecture is future-proof.** A third target (mobile, kiosk) is a new
  three-line shell. This is the concrete meaning of "do not design two
  applications".
- **Testing is straightforward.** Tests mount `<AppRoot/>` directly with a test
  router — no need to boot a server just to render a route.

## Consequences

Positive:

- A feature implemented once is available on both targets immediately.
- Desktop-specific work (window, print, filesystem) lives in the platform
  adapter and never spreads into feature code.
- Web and desktop builds can fail independently, which is what you want for CI
  matrix builds.

Negative / accepted costs:

- **An extra package hop.** Vite must transpile the workspace package source
  (configured via `optimizeDeps`/workspace resolution). In a monorepo this is
  standard; it is the main build-performance consideration to watch.
- **Tailwind must scan the shared package.** Solved with Tailwind v4
  `@source "../../packages/app/src"` directives so the design system stays in the
  shared app package rather than in a shell.
- **A new developer must know the app lives in `packages/app`, not `apps/web`.**
  Documented in `AGENTS.md`, `docs/frontend.md` and the root README.

## Alternatives rejected

- **Application in `apps/web`, desktop builds from it:** fragile Vite roots
  across workspaces, unclear ownership, harder to test in isolation. Rejected.
- **No `packages/app`, one app with two configs:** hides the deployable
  boundary; per-target env and build steps get tangled. Rejected.
- **Symlink the app source into `apps/desktop`:** breaks tooling (Tailwind
  content globs, tsconfig paths, Vitest roots) and is invisible in `git status`.
  Rejected.

## Verification

- `pnpm run guard:boundaries` fails if `apps/web/src` or `apps/desktop/src`
  contains anything other than `main.tsx` (+ env typing).
- `pnpm --filter @denti-code-u3/web build` and
  `pnpm --filter @denti-code-u3/desktop build` both emit bundles from the same
  application source.
