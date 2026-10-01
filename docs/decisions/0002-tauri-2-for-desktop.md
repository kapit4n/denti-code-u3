# ADR 0002 — Use Tauri 2 for the desktop target

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `apps/desktop`, packaging, platform capabilities

## Context

Denti-Code U3 must run as a desktop application in addition to the browser.
Desktop matters for a clinic workstation: it is used on a dedicated machine, all
day, often with a printer, a scanner, and multi-monitor setups. Requirements:
small memory footprint compared with Electron, fast startup, a small installer,
access to native capabilities (printing, filesystem, notifications, window
control) behind a boundary, and the ability to render the _same_ React
application as the web target.

Options considered:

1. **Electron** — mature, everything works, but ~150 MB baseline RAM, large
   bundle, Chromium version lag.
2. **Tauri 2** — Rust core + the OS webview, small bundle, low memory, growing
   plugin ecosystem, supports Linux/Windows/macOS.
3. **PWA only** — no installer, no filesystem/print integration, no true offline
   behaviour; not a desktop application in the clinic-workstation sense.
4. **Native (Swift/Qt/.NET)** — would require a second implementation of the
   entire UI. Rejected immediately: it violates "one React application".

## Decision

Use **Tauri 2** for the desktop shell. The Tauri process contains **no
business logic, no React and no SQL**. It:

1. serves/loads the same React application as web (built from `packages/app`),
2. exposes desktop capabilities through a narrow, typed platform interface.

`apps/desktop/src-tauri` is forbidden from importing Drizzle, `postgres`, or any
domain package. All database access stays server-side.

## Rationale

- **One application, one domain.** Because the desktop target hosts the same
  React bundle, features cannot fork between targets.
- **Small footprint.** The OS webview (WebKitGTK on Linux, WebView2 on Windows,
  WKWebView on macOS) replaces a bundled Chromium, which matters for an
  all-day workstation.
- **Native capabilities where they belong.** Printing, filesystem, notifications
  and window behaviour are exactly what clinics need from a desktop app; Tauri
  provides them without granting the React layer arbitrary system access.
- **Rust is a good boundary.** A memory-safe core for the shell is appropriate
  for a clinical product; the boundary is enforced by convention _and_ by the
  dependency guard.

## Consequences

Positive:

- Installer and memory footprint stay small.
- One codebase for the UI; desktop-only capabilities are additive.
- Rust webview differences are a known, contained risk (see negatives).

Negative / accepted costs:

- **OS webview variance.** WebKitGTK (Linux) behaves differently from WebView2
  (Windows) and WKWebView (macOS). Mitigation: target evergreen Chromium
  features only, keep the supported platform list explicit, and treat Linux
  WebKitGTK quirks as a known issue in `docs/desktop.md`.
- **Plugin maturity.** Some plugins are younger than Electron equivalents.
  Mitigation: every capability goes through `packages/app/src/platform`, so a
  plugin can be swapped without touching features.
- **Rust toolchain required** to build the desktop target. Documented in
  `docs/desktop.md`; web and API remain buildable without Rust.
- Tauri v2 requires a Rust toolchain and system libraries
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`) on Linux. These are
  documented prerequisites; the web/API targets never need them.

## Alternatives rejected

- **Electron:** rejected for RAM/bundle/startup cost on all-day workstations.
- **PWA only:** cannot satisfy desktop requirements (no filesystem, no print
  integration, no installer).
- **Native UI:** second implementation of everything — directly contradicts the
  one-application principle.

## Verification

`pnpm run dev:desktop` starts Vite and the Tauri shell against the same React
application; `pnpm run build:desktop` produces an installable bundle. See
`docs/desktop.md` for the Linux system-library prerequisites.
