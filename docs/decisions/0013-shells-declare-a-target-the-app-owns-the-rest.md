# ADR 0013 — The shells declare a target; the shared app owns everything else

- Status: Accepted
- Date: 2026-10-01
- Decides: what a deployment shell may configure, and what it may never own

## Context

ADR-0008 established one React application in `packages/app` with thin shells, and
ADR-0009 introduced the platform capability contract. Milestone 2 wires the first
real routing layer: TanStack Router, TanStack Query and a shared `ApiClient`.

The wiring immediately produced three defects, all from the same root cause — the
line between "what the shell declares" and "what the shared app decides" was
never written down, so each file quietly assumed the other side's half.

1. **The desktop app rendered as web.** The runtime badge in the header read
   `Web · America/La_Paz` while running inside the desktop shell. The shell passed
   `target: 'desktop'` and no capabilities; `mountApp` then passed
   `{ capabilities: undefined }` as the router context; `createRouter` honoured
   that present-but-empty object; and `AppRoot` fell back to the web defaults. No
   step was individually wrong, and no type or test failure pointed at it.

2. **`VITE_API_URL` was silently `undefined`.** Vite resolves `.env` against its own
   root, which is `apps/web`, but the documented `.env` lives at the monorepo root.
   The app threw `VITE_API_URL is not defined` on startup — a loud failure, but only
   in a browser. Every unit test passed, because tests supply `apiBaseUrl`
   explicitly and never read the environment.

3. **The generated route tree was untracked.** `routeTree.gen.ts` was gitignored, so
   `pnpm typecheck` on a fresh clone failed with `TS2307`. The file was only ever
   produced by a dev server or build, which meant CI had to build before it could
   typecheck.

Only the e2e suite caught any of these. Unit tests were green throughout, because
each test supplied exactly the input whose handling was correct.

## Decision

### 1. A shell declares a target and nothing else

A shell's entire source is:

```ts
mountApp({ target: 'desktop' });
```

The shell may add **capabilities** when it has native implementations to offer.
It may not pass a query client, a router, a history, or a route. `target` selects
history type and API URL; `capabilities` supplies platform operations. Everything
else — router construction, provider nesting, route tree, frame — is the shared
app's.

### 2. Missing capabilities are resolved from the target, once, in one place

`createAppRouter` is the single point that fills capabilities:

```ts
const resolvedContext: RootRouteContext = context ?? {
  capabilities: capabilitiesForTarget(target),
};
```

Two properties make this work, and both are load-bearing:

- The context is omitted entirely when the shell supplies no capabilities, rather
  than passed as `{ capabilities: undefined }`. A present object suppresses the
  default; an absent one triggers it.
- `RootRouteContext.capabilities` is **required**, not optional. Optional would
  force every consumer to write a fallback branch for a state that cannot occur,
  and would have hidden defect 1.

`PlatformProvider` and `AppRoot` therefore take `capabilities` as a required prop.
There is no second "fall back to web" path, because a second path is what made the
bug invisible.

The root route uses `createRootRouteWithContext<RootRouteContext>()`, not
`createRootRoute`. With the plain constructor the generated tree infers the context
as `{}`, so `context.capabilities` fails to typecheck even though the value is
present at runtime — the type system and the runtime disagreed.

### 3. Vite reads the monorepo-root `.env`

Both shells set `envDir` to the workspace root. The alternative — duplicating
`.env` into each shell — invites the two copies to drift, and the desktop value
would silently track the web one.

`mountApp` fails loudly when no URL is defined. That behaviour is correct and is
kept: a misconfigured build should not ship a client whose first request fails with
an opaque network error.

### 4. The generated route tree is committed

`packages/app/src/routeTree.gen.ts` is tracked. `tsc` runs with no Vite plugin in
the process, so on a fresh clone an untracked tree means `pnpm typecheck` fails
before anything has been built. Generation is deterministic — the same routes
produce a byte-identical file — so a stale copy is never committed by accident:
adding or renaming a route changes the file and appears in `git diff`. It stays in
`.prettierignore` so formatting never rewrites generated output.

### 5. Shells are verified in a real browser

Unit tests alone cannot catch any of the three defects above, because each test
supplies the input whose handling is correct. The web e2e suite therefore asserts
behaviour that only exists at runtime: the route tree mounts, the frame renders
exactly once, the design tokens resolve, and the console is clean.

## Consequences

- `apps/web` and `apps/desktop` differ by one string. That is now checked rather
  than asserted in prose.
- A capability the app needs on desktop but has no implementation for rejects with
  `PlatformUnsupportedError`. The desktop shell reports `hasNativeShell: true` from
  its declared target while OS-backed operations still reject. This is honest: it
  is a native shell whose native operations are not implemented yet, and the
  alternative is pretending a call succeeded.
- `packages/app/src/platform/index.ts` currently answers for both targets. When a
  feature needs a real native dialog, the desktop shell passes its own
  implementation through `mountApp({ capabilities })`, and no other file changes.
- `RootRouteContext.capabilities` being required means a new shell entry point must
  go through `mountApp`. A shell that assembled its own router would fail to
  typecheck.

## Alternatives rejected

**Have each shell build its own router and providers.** Rejected: it is the exact
duplication ADR-0008 exists to prevent, and it is how the web and desktop apps
would drift.

**Probe for Tauri at runtime instead of accepting a declared target.** Rejected:
architecture rule 5 forbids the app from importing Tauri APIs, and a runtime probe
cannot tell "desktop shell" from "a browser opened on localhost during
development" — which is why the badge lied.

**Keep `capabilities` optional and fix only `mountApp`.** Rejected: it treats the
symptom. Optional capabilities invite a fallback at every consumer, and the next
shell that forgets to pass them gets the same silent wrong-runtime bug.

**Have the e2e suite read the banner only.** Rejected: it would have caught defect 1
but not defect 2 or 3. Asserting route mounting, single-frame rendering, resolved
tokens and a clean console covers all three classes.
