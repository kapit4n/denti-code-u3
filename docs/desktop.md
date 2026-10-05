# Denti-Code U3 — Desktop Strategy

Decision record: [ADR 0002](./decisions/0002-tauri-2-for-desktop.md).
Platform boundary: [ADR 0009](./decisions/0009-platform-abstraction.md).

---

## 1. What the desktop app is

A **host** for the same React application the browser runs, packaged as a native
application with Tauri 2. It is not a second application, not an offline client,
and not a database client.

```
Tauri 2 (Rust)
   └── loads the SAME React bundle as web (built from packages/app)
          └── packages/app → api-client → REST API → PostgreSQL
```

Concretely:

| Concern           | Desktop                         | Web                          |
| ----------------- | ------------------------------- | ---------------------------- |
| UI code           | `packages/app`                  | `packages/app`               |
| Routing           | `packages/app/src/routes`       | `packages/app/src/routes`    |
| Data              | `packages/api-client` → REST    | `packages/api-client` → REST |
| Database          | none                            | none                         |
| Host capabilities | via `packages/app/src/platform` | via `platform/web.ts`        |

## 2. Layout

```
apps/desktop/
├── index.html              same shape as web (Vite entry document)
├── vite.config.ts          fixed port 5174, Tauri-friendly HMR + build target
├── src/main.tsx            identical to apps/web/src/main.tsx
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json     window config, build command, CSP
    ├── build.rs
    ├── capabilities/       Tauri v2 capability grants (minimal)
    └── src/{main.rs,lib.rs}
```

`src-tauri` contains Rust only: window creation, the webview, and Tauri command
registration. It must not import Drizzle, `postgres`, or any domain module
(guard rule 4).

## 3. Platform capabilities

`packages/app/src/platform` defines the interface; `desktop.ts` implements it via
Tauri, `web.ts` implements the browser subset. Capabilities are **optional and
reported honestly** — the UI hides or disables what the host cannot do.

| Capability            | Web                                 | Desktop                    | Implementation note                |
| --------------------- | ----------------------------------- | -------------------------- | ---------------------------------- |
| `storage` (key/value) | `localStorage`                      | app data dir JSON file     | preferences, sidebar state         |
| `notifications`       | Web Notifications (with permission) | Tauri notification plugin  | appointment reminders (later)      |
| `printing`            | `window.print()` for HTML           | Tauri print/webview dialog | clinical reports, invoices (later) |
| `files`               | File input / download               | Tauri dialog + fs plugin   | radiograph import/export (later)   |
| `window`              | ✗                                   | Tauri window API           | minimize/maximize/close            |
| `openExternal`        | `window.open`                       | Tauri opener plugin        | help links, mailto                 |

Only `storage` and `window` are wired in the foundation phase; the rest of the
interface is added when a feature needs it (no speculative capability work —
rule 18).

## 4. Configuration

- The desktop shell reads the API URL from its own env (`VITE_API_URL`), so a
  desktop build can point at a different backend (clinic LAN server vs cloud)
  without touching feature code.
- The build embeds this at compile time (Vite env), and the runtime can
  override it through the platform storage (planned: an environment switcher in
  Settings — a product decision, Milestone 12).
- There is no local database and therefore no local secrets beyond the API URL.

## 5. Security posture

- Tauri capabilities are minimal: only the windows and plugins actually used are
  granted in `src-tauri/capabilities/`.
- No filesystem-wide access; no shell plugin; no arbitrary command execution.
- The webview loads only local bundled assets in release builds (no remote URL
  loading), with a CSP that disallows remote script execution.
- `connect-src` in that CSP names the API origin, and it has to be kept in step
  with `VITE_API_URL`. When `API_PORT` moved to 3010 the CSP was left at 3000 and
  the desktop app blocked every request it made — a shell that rendered over an
  empty agenda, with nothing in any log.
  `apps/desktop/test/tauri-config.test.ts` asserts the two agree, against
  `.env.example` so a clinic LAN URL in a developer's own `.env` cannot fail it.
- Clinical data is never written to the desktop app's local store; only UI
  preferences are persisted.

## 6. Development

```bash
pnpm run dev:desktop      # vite dev server (5174) + tauri dev window
pnpm run build            # the webview bundle for every package, including this one
```

Tauri dev expects the Vite dev server on the configured port; the config uses
`beforeDevCommand` to start it automatically. `tauri dev` is for writing the app.
It is not a build you can keep, because the webview loads from `devUrl` and the
assets are served from the working tree at that moment.

### Keeping a build that works

```bash
./scripts/run-desktop.sh        # the shortest way in: run the newest kept build
./scripts/run-desktop.sh 2      # the one before it
./scripts/run-desktop.sh pins   # what is kept, and what each came from

pnpm run desktop:pin            # build the tree and keep the binary
pnpm run desktop:run            # the same thing the script does
pnpm run desktop:run 2
pnpm run desktop:pins
pnpm run desktop:forget         # delete them
```

`run-desktop.sh` is the counterpart to `dev-desktop.sh`: that one starts a window
from the working tree, which is what you want while writing and useless the moment
the tree does not compile. This one opens a window from a build that was already
pinned. It resolves the repository from its own location, so it works from any
directory and through a symlink on the desktop, and it calls `node` directly rather
than `pnpm` — launching a fallback should not depend on the package manager that
built the tree. All it adds is a default argument; the logic is the same
`scripts/desktop-pin.mjs` that `pnpm run desktop:run` runs, so the two cannot
drift.

A native window cannot be opened if the tree does not compile, which is the one
moment you most want to open it. `desktop:pin` builds with
`tauri build --debug --no-bundle` — the frontend is a production build with its
assets embedded in the binary, so the result runs on its own — and keeps the file
in `.desktop-known-good/` (gitignored, three kept, ~200 MB each) with a manifest
recording the commit it came from and the API URL it was compiled against.

Pin after clicking through a build that works, not after a build that merely
compiles. The rationale, and the reasoning behind the debug profile, is in
[ADR 0019](./decisions/0019-keep-the-last-desktop-build.md).

## 7. Known constraints and limitations

- **Linux build prerequisites:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
  `librsvg2-dev`, plus build essentials. These are _documented prerequisites_, not
  something to work around — see §8.
- **OS webview variance:** WebKitGTK / WebView2 / WKWebView differ. The app
  targets evergreen Chromium-baseline CSS/JS; platform-specific styling is kept
  to a minimum.
- **Requires network access to the API:** by design (ADR 0003). A clinic
  without connectivity loses the desktop app; this is a documented product
  limitation, not a bug. Offline is a possible future milestone with its own
  ADRs.
- **No local data:** no local backup, no local export, no local database.
  Requesting these is a product conversation, not an implementation detail.

## 8. Verification status on this machine

**A native build completes here.** `cargo 1.97` and the WebKitGTK 4.1
development libraries are both present, and `pnpm run desktop:pin` produces a
running window — see ADR 0019 for what was launched and observed. The §7
prerequisites are therefore documented requirements rather than a live
limitation, and they stay documented for a machine that does not have them.

What has not been run is a **release** build: `tauri build` in the release profile,
and the `deb`/`msi`/`app`/`dmg` bundles in `bundle.targets`. Nothing in the
verification above depends on them, and the profile difference between the debug
build used for manual testing and a release build is optimisation, not
behaviour. Signing and packaging remain unverified.
