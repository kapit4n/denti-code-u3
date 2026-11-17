# ADR 0041 — The desktop installer embeds a local clinic server

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decides:** whether one desktop installer can deliver both the UI and its clinic API
- **Related:** [ADR 0002](./0002-tauri-2-for-desktop.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0030](./0030-development-login-as-is-gated-by-route-existence.md), [ADR 0038](./0038-tag-driven-windows-msi-release.md), [ADR 0039](./0039-ubuntu-deb-release.md), [ADR 0040](./0040-server-bundle-with-initial-data.md)

## Context

ADR 0040 deliberately kept the desktop installer thin. It ships a webview compiled
against `http://localhost:3010/api/v1`, while a separate server bundle supplies a
Node runtime, the Fastify API and a migrated/seeded SQLite database. That solves
first-run data but still requires two downloads and two install steps.

A single-workstation clinic does not need two artifacts. It wants an installer that
opens to a usable login screen. This is now possible without a third database
strategy: ADR 0025 already makes SQLite the default engine, and the API is the only
component allowed to open it. What changes is the deployment topology — the local
database moves from a separate archive into the desktop installer's app data
directory, and Tauri owns the lifecycle of the API process that opened it.

The old "no local database" rule in ADR 0002 described the desktop as a network
client. This ADR replaces that rule for the shipped installer. It does not turn the
webview into a database client and does not add offline synchronization.

## Decision

1. **The MSI and DEB embed the seeded server bundle as Tauri resources** under
   `denti-code-server/`: the Node runtime, the built API with production
   `node_modules`, and the initial SQLite database. `scripts/build-desktop-server-resources.mjs`
   reuses `scripts/build-server-bundle.mjs` so the two deliveries cannot drift.
2. **Tauri starts the API at application startup.** It launches the bundled Node
   binary with `dist/main.js`, binds `127.0.0.1:3010`, and stops the child when the
   last window is destroyed. Port `3010` must be free; runtime port negotiation is
   an OPEN QUESTION because the API URL is compiled into the webview.
3. **The database lives in the OS app data directory.** On first launch the embedded
   seeded file is copied to `app_data_dir/server/denti-code-u3.db`; later launches
   reuse the existing file. Logs go beside it. The API remains the sole owner of all
   SQL; Tauri and React never open the database.
4. **The embedded API runs with `NODE_ENV=production`.** The development-only
   endpoints from ADR 0030 stay unregistered. Each build has a generated admin
   password, stored in the embedded `desktop-server.json` and shown once in the
   login screen through a platform capability. The web implementation of that
   capability returns `undefined`.
5. **The separate server bundle stays.** It is still the LAN/multi-client answer and
   is published beside the MSI and DEB. A clinic can use the all-in-one installer,
   the separate server, or both; the REST contract is identical.
6. **Release CI builds the embedded resources per platform before Tauri bundles.**
   The Windows job embeds a Windows Node runtime; the Ubuntu job embeds a Linux one.
   This is a build-time choice, not an abstraction over two engines.

## Rationale

One installer removes the most common first-run failure: the desktop app renders a
login screen but there is no API behind it. Reusing the server bundle script keeps
the embedded API byte-for-byte close to the separately published one, including the
workspace transpilation and the seeded clinic data.

Copying the seed database to app data rather than opening it from the read-only
install location keeps writes in a per-user writable directory and preserves data
across upgrades. Binding to loopback avoids exposing a clinic API to the LAN by
default; the separate bundle remains available when a LAN server is wanted.

The generated password avoids the fixed `denti-code-dev` credential of a plain
development seed. Showing it through the existing platform abstraction keeps React
free of Tauri API imports (architecture rule 5).

## Consequences

- The MSI/DEB are larger: each carries a Node runtime and `node_modules`.
- A local API process runs for the lifetime of the desktop app and is stopped on
  window destruction. A crash of that process leaves the login screen unable to
  sign in; the API log is in app data.
- Port `3010` must be free. A separate dev API or server bundle on the same machine
  prevents the embedded API from starting.
- The initial password is per-build. [ADR 0042](./0042-password-change-and-first-admin-bootstrap.md)
  adds a password-change screen in Settings; the login banner is for bootstrap, not a
  credential manager.
- The seed fixes appointment dates relative to build time. An installer kept for
  months shows an old calendar until reseeding is designed.
- An upgrade must not overwrite an existing app-data database. A future migration
  strategy is still required before clinical data is real.
- No offline mode, no sync engine, no third database and no direct Tauri SQL.

## Alternatives rejected

- **Keep only the separate server bundle.** Still two installs and the original
  empty-login first-run failure.
- **Open SQLite from Rust or React.** Violates ADR 0002/0014's API ownership and
  would duplicate the domain's persistence rules in the shell.
- **Use the development seed password in every installer.** The same credential in
  every copy makes production login meaningless.
- **Download the database at install time.** Needs a host, breaks offline install,
  and leaves path handling to the operator.
- **Add a second database engine or sync layer.** Explicitly out of scope.
