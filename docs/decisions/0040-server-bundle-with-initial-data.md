# ADR 0040 — A separate server bundle carries the API and its initial database

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decides:** how an installation gets a clinic API with data on first launch
- **Related:** [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0028](./0028-authentication-is-opaque-bearer-sessions.md), [ADR 0030](./0030-development-login-as-is-gated-by-route-existence.md), [ADR 0038](./0038-tag-driven-windows-msi-release.md), [ADR 0039](./0039-ubuntu-deb-release.md)

## Context

The desktop installers from ADR 0038 and ADR 0039 contain a webview and no data.
They are compiled against `http://localhost:3010/api/v1` and expect a clinic API
on the same machine. A fresh install therefore shows a login screen with no users
until somebody clones the repository, runs `db:migrate` and `db:seed`, and starts
the API. The seeded users are created only by that manual development step, and
ADR 0030 keeps the password-free sign-in endpoints out of production API
processes.

There are three ways to make an installed application open with data: put the API
and a database inside the desktop installer, publish a ready-made database file,
or distribute the API and its database as a separate server package. The first
would overturn the "no local database" rule in ADR 0002 and need Tauri sidecar
startup and database lifecycle management. The second leaves the user to find
and place the file correctly. The third matches the existing deployment contract:
the desktop app already expects a separate API on localhost.

## Decision

1. **The server is a separate, self-contained bundle**, built by
   `scripts/build-server-bundle.mjs` and published as an archive alongside the
   desktop installers. The MSI and DEB are unchanged.
2. **The bundle contains the built API, its production `node_modules`, a Node
   runtime, `start.sh` / `start.cmd`, and a migrated and seeded SQLite database**
   at `data/denti-code-u3.db`. The start scripts derive an absolute `sqlite:`
   URL from their own location, so the bundle can be moved anywhere.
3. **Workspace packages are transpiled inside the bundle.** They ship as
   TypeScript source and Node refuses type stripping under `node_modules`, so the
   build emits sibling `.js` files and repoints each package's export map. The
   repository source is never modified.
4. **The bundle runs with `NODE_ENV=production`.** The development sign-in
   endpoints from ADR 0030 stay unregistered, and the only way in is a password.
5. **Every bundle gets its own generated admin password**, written into the
   bundle README and printed by the build. `--password` or
   `INITIAL_ADMIN_PASSWORD` overrides it. A plain `pnpm run db:seed` still uses
   the old development password, so existing local workflows do not change.
6. **CORS includes the Tauri origins** (`tauri://localhost` and
   `http://tauri.localhost`) in addition to the web dev origins from
   `.env.example`. Other settings come from `.env.example` so there is still one
   source of truth for the clinic id, timezone and auth limits.
7. **One archive per platform** (`tar.gz` on Linux, `zip` on Windows) is uploaded
   to the same draft release by two jobs that wait for the release-owning MSI
   job, following ADR 0039's release handoff.

## Rationale

A separate server package is the smallest change that delivers "installed with
data" without inventing a third database strategy. It keeps the API as the sole
owner of database access (ADR 0002, ADR 0014) and leaves both deployment targets
on the same REST contract.

Including the Node runtime avoids a second installation step and pins the ABI
that `better-sqlite3` was compiled against on the build runner. Deriving the
database URL at launch rather than baking an absolute path into the archive keeps
the bundle relocatable.

A generated password avoids shipping the well-known `denti-code-dev` credential
in a distributable. Putting it in the bundle README makes it available to
whoever installs that specific artifact without publishing it in the release
notes.

## Consequences

- Users now install two artifacts: the desktop app and the server bundle. The
  order does not matter as long as the server is running before sign-in.
- The bundle is platform-specific: the native SQLite binding and the bundled
  Node binary match the runner that built it.
- The initial password is per-build and there is no password-change screen yet
  (**OPEN QUESTION**). The bundle README says to rotate it before storing real
  patient data.
- The seeded appointments are relative to the build date, so an old bundle has an
  old calendar. A future release can decide whether bundles should reseed on
  first launch instead.
- Production PostgreSQL is still a separate deployment. This bundle selects the
  SQLite engine through `DATABASE_URL` and does not add a third engine or an
  abstraction over the two.
- The archive is gitignored; only the build script and documentation are source.

## Alternatives rejected

- **Putting Node, the API and SQLite inside the MSI/DEB.** Self-contained, but a
  major architecture change: a Tauri sidecar, database lifecycle in Rust, and an
  ADR overturning the no-local-database rule.
- **Publishing only the seeded `.db` file.** It would still require a Node
  installation and a checkout of the API, and it would leave the path contract to
  the user.
- **Keeping `NODE_ENV=development` in the bundle.** It would expose the
  password-free sign-in endpoints from ADR 0030 as every seeded role, including
  administrator.
- **Shipping the fixed development password.** It is the same credential in every
  copy of every release and would make the production-mode login worthless.
