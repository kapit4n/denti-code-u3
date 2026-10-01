# ADR 0009 — Platform abstraction isolates every desktop-only capability

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `packages/app/src/platform`, `apps/desktop/src-tauri`, future printing/notifications

## Context

The desktop target will need capabilities the browser either lacks or restricts:
printing clinical documents, reading/writing files (radiographs, backups),
native notifications, window control, application settings storage, "open file"
dialogs. The brief is explicit: keep platform-specific functionality isolated,
never let React depend directly on Tauri APIs, and access capabilities through a
platform abstraction.

The failure mode this prevents is well known: `if (isTauri()) { await invoke(...) }
else { ... }` sprinkled through forty components, with type errors on the web
build and untestable branches.

## Decision

Introduce `packages/app/src/platform` as the **only** place in the React
application that knows which host it is running in.

```
packages/app/src/platform/
├── types.ts      PlatformCapabilities interfaces (storage, files, notifications,
│                 printing, window, openExternal)
├── web.ts        browser implementation
├── desktop.ts    Tauri-backed implementation
├── index.ts      createPlatform() → desktop if __TAURI_INTERNALS__ present
└── use-platform.ts  React hook + provider
```

Rules (guard rule 4):

- `@tauri-apps/api*` may be imported **only** in `packages/app/src/platform/desktop.ts`
  and in `apps/desktop/src-tauri/**`.
- Features and components import `usePlatform()`; they never import Tauri, never
  check `isTauri`, never call `invoke`.
- Every capability is **optional** (`canPrint: boolean`). The desktop
  implementation reports what the installed Tauri plugins actually support, and
  the web implementation reports `false`. Features degrade visibly rather than
  crashing.
- Capabilities are added **when a feature needs them**, not in advance. The
  interface currently has the small set of capabilities the shell already needs;
  it grows with real requirements.
- Dynamic import of the Tauri modules inside `desktop.ts` keeps the web bundle
  free of Tauri code.

## Rationale

- **The web bundle stays clean.** Web never downloads Tauri code, and web
  behaviour is the default path.
- **Testability.** Features are tested against an injected fake platform; no
  Tauri runtime needed in tests.
- **One place to change.** Swapping the desktop host, adding a capability, or
  changing the plugin strategy touches exactly one file.
- **Honest capability reporting.** Optional capabilities with explicit `false`
  prevent "works on desktop, silently broken on web" bugs.

## Consequences

Positive:

- Features are host-agnostic by construction; they compile and run in both
  targets without conditional code.
- A capability that is unavailable on the web target is a declarative fact the
  UI can use to hide or disable an action.
- Desktop features are added incrementally, without a "desktop rewrite".

Negative / accepted costs:

- **One abstraction layer for every capability.** For a trivial need (e.g.
  "close the window") this is extra indirection. Accepted: the layer is the
  reason web and desktop remain one application.
- **Capabilities may be uneven between platforms.** Mitigated by explicit
  optionality and by the UI checking capability availability.
- **A new capability requires touching web + desktop + types.** Deliberate: it
  forces a decision about web behaviour instead of leaving it accidental.

## Alternatives rejected

- **Call Tauri directly from components:** simplest, but couples the whole UI
  to one host and breaks the web build. Rejected — the brief forbids it.
- **`if (isDesktop)` feature flags scattered through the app:** same problem,
  harder to find and impossible to remove. Rejected.
- **Tauri plugins as a web-compatible shim:** plugins are not web-safe and would
  leak host abstractions into features. Rejected.
- **A separate desktop-only React app:** directly violates "one React
  application". Rejected.

## Verification

- `pnpm run guard:boundaries` fails on any `@tauri-apps/*` import outside
  `packages/app/src/platform/desktop.ts` and `apps/desktop/src-tauri/**`.
- Unit tests run with a fake platform implementation injected.
