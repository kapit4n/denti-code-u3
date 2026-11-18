# Denti-Code U3 — Desktop Strategy

Decision record: [ADR 0002](./decisions/0002-tauri-2-for-desktop.md).
Platform boundary: [ADR 0009](./decisions/0009-platform-abstraction.md).
Embedded local API: [ADR 0041](./decisions/0041-desktop-installer-embeds-local-clinic-server.md).
Separate LAN server bundle: [ADR 0040](./decisions/0040-server-bundle-with-initial-data.md),
[`docs/server-bundle.md`](./server-bundle.md).

---

## 1. What the desktop app is

A **host** for the same React application the browser runs, packaged as a native
application with Tauri 2. It is not a second application and not an offline client.
The installed MSI/DEB also embeds a local clinic server (ADR 0041), so one installer
opens to a working login screen.

```
Tauri 2 (Rust)
   ├── loads the SAME React bundle as web (built from packages/app)
   │      └── packages/app → api-client → REST API on 127.0.0.1:3010
   └── starts the bundled Node API; SQLite lives in the app data directory
```

Concretely:

| Concern           | Desktop                                       | Web                          |
| ----------------- | --------------------------------------------- | ---------------------------- |
| UI code           | `packages/app`                                | `packages/app`               |
| Routing           | `packages/app/src/routes`                     | `packages/app/src/routes`    |
| Data              | `packages/api-client` → REST                  | `packages/api-client` → REST |
| Database          | app-data SQLite, opened only by the local API | none                         |
| Host capabilities | via `packages/app/src/platform`               | via `platform/web.ts`        |

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

- The desktop shell reads the API URL from its own env (`VITE_API_URL_DESKTOP`,
  falling back to `VITE_API_URL`), so a desktop build can point at a different
  backend (clinic LAN server vs cloud) without touching feature code.
- The build embeds this at compile time (Vite env), and the runtime can
  override it through the platform storage (planned: an environment switcher in
  Settings — a product decision, Milestone 12).
- An installed build embeds a seeded local API at `127.0.0.1:3010`. The database is
  copied from the installer to `app_data_dir/server/` on first launch and reused
  afterwards; the generated password is exposed through
  `getLocalClinicCredentials()` on the platform abstraction.

## 5. Security posture

- Tauri capabilities are minimal: only the windows and plugins actually used are
  granted in `src-tauri/capabilities/`. The embedded API is a child process created
  in Rust; the webview has no shell or filesystem capability.
- No filesystem-wide access; no shell plugin; no arbitrary command execution from
  the webview. The local API binds only `127.0.0.1`.
- The webview loads only local bundled assets in release builds (no remote URL
  loading), with a CSP that disallows remote script execution.
- `connect-src` in that CSP names the API origin, and it has to be kept in step
  with `VITE_API_URL`. When `API_PORT` moved to 3010 the CSP was left at 3000 and
  the desktop app blocked every request it made — a shell that rendered over an
  empty agenda, with nothing in any log.
  `apps/desktop/test/tauri-config.test.ts` asserts the two agree, against
  `.env.example` so a clinic LAN URL in a developer's own `.env` cannot fail it.
- Clinical data is written only to the embedded API's SQLite file in the app data
  directory, never to the webview's key/value store. UI preferences stay separate.

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
- **Port `3010` must be free:** the embedded API binds it at startup. A developer
  API or separately downloaded server bundle already on that port prevents launch;
  this is reported as a startup error and written to the app-data log. Runtime port
  negotiation is an OPEN QUESTION because the API URL is compiled into the webview.
- **Local data is single-workstation:** the app-data SQLite file is not shared with
  other machines. Clinics needing several workstations use the separate server
  bundle or a hosted API. There is no offline mode or synchronization (ADR 0041).
- **No local backup/restore yet:** the database file exists, but backup and restore
  are still product work. Change the generated password in Settings before real data;
  see [ADR 0042](./decisions/0042-password-change-and-first-admin-bootstrap.md).

## 8. Verification status on this machine

**A native build completes here.** `cargo 1.97` and the WebKitGTK 4.1
development libraries are both present, and `pnpm run desktop:pin` produces a
running window — see ADR 0019 for what was launched and observed. The §7
prerequisites are therefore documented requirements rather than a live
limitation, and they stay documented for a machine that does not have them.

What has not been run here is a **release** build: `tauri build` in the release
profile with the `deb`/`msi`/`app`/`dmg` bundles in `bundle.targets`. It cannot be:
the MSI bundle needs WiX v3, which runs only on Windows. §9 is the pipeline that
builds the installers on GitHub runners; its runs are the verification, and the
installers are unsigned. Nothing in the local verification above depends on them,
and the profile difference between the debug build used for manual testing and a
release build is optimisation, not behaviour.

## 9. Releasing the desktop installers

Installers are made by a tag, not by a branch. The Windows MSI from `v0.1.0` was
the first run, `v0.1.1` added the Ubuntu `.deb`, `v0.1.2` added the seeded
separate server bundles, `v0.1.3` first added the embedded local server, and
`v0.1.4` fixes its Windows resource bundling:

```bash
git tag v0.1.4
git push origin v0.1.4
```

`.github/workflows/release-desktop.yml` then checks that the tag equals `v` plus
the version in `tauri.conf.json` and runs four jobs. The `msi` job uses
`windows-2022` for WiX v3, runs `pnpm run bundle:desktop-server` to embed a Windows
Node runtime and the seeded API, calls `tauri build --bundles msi` through
`tauri-apps/tauri-action@v1`, creates the **draft** GitHub release, and passes its
`releaseId` to the `deb` job. The `deb` job waits for it, installs WebKitGTK 4.1
and the other Tauri system libraries on `ubuntu-22.04`, builds Linux resources and
calls `tauri build --bundles deb`. Both bundles are uploaded to the same draft
release and kept as workflow artifacts. Two more jobs wait for that release too
and upload the separate Linux and Windows server bundles described in
`docs/server-bundle.md`, so the draft has four assets. The handoff matters: two
jobs creating a release for one tag would race and could leave two drafts.
Publishing stays a separate, human act; see ADR 0038, ADR 0039, ADR 0040 and ADR 0041.

`ubuntu-22.04` is the Linux baseline because it supplies WebKitGTK 4.1 from its
standard repositories and its glibc is old enough for the `.deb` to run on older
Ubuntu and Debian systems. Building on a newer image would raise that floor.

Both builds read the desktop API URL from `.env.example` before invoking Vite, so
the compiled API URL and the webview CSP still agree — the same contract
`apps/desktop/test/tauri-config.test.ts` checks locally. The installers call
`http://localhost:3010/api/v1`, which the embedded API serves on the same machine.
The separate server bundle serves the same URL for clinics that want a shared
server. Repointing the compiled URL means changing `.env.example` and the CSP
together and cutting a new tag, not changing a secret at install time.

`bundle.icon` names the generated Windows `icon.ico` and the Linux PNG set
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`). `--no-bundle` builds
never needed them; bundles do. The pipeline produces only MSI and DEB: macOS,
NSIS and the updater manifest are deliberately out of scope.
