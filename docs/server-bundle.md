# Server bundle with initial data

The desktop MSI/DEB is a webview compiled against `http://localhost:3010/api/v1`
(`docs/desktop.md`). Since ADR 0041 the installers embed a local copy of this API.
This separate bundle supplies the same API and an already migrated and seeded
SQLite database for clinics that want a shared or standalone server, or that
prefer to run the server outside the desktop app.

The decision and its limits are recorded in
[ADR 0040](./decisions/0040-server-bundle-with-initial-data.md) and
[ADR 0041](./decisions/0041-desktop-installer-embeds-local-clinic-server.md).

## Build one locally

From the repository root, with Node 22 and pnpm available:

```bash
pnpm run bundle:server
```

That writes a platform-specific directory and archive under `.artifacts/`:

```
.artifacts/denti-code-u3-server-0.1.3-linux-x64/
.artifacts/denti-code-u3-server-0.1.3-linux-x64.tar.gz
```

Useful options:

```bash
pnpm run bundle:server -- --out /tmp/releases
pnpm run bundle:server -- --password 'a-long-private-password'
INITIAL_ADMIN_PASSWORD='a-long-private-password' pnpm run bundle:server
```

Without `--password`, a random password is generated per build. The build prints
it once and writes it into the bundle's `README.md`. A short password (under 12
characters) is rejected.

## What is inside

```
denti-code-u3-server-<version>-<platform>-<arch>/
  README.md              first sign-in details
  start.sh / start.cmd   launcher for this platform
  runtime/node           the Node binary used at build time
  server/                built API + production node_modules
  data/denti-code-u3.db  migrated and seeded SQLite database
```

Workspace packages normally ship as TypeScript source. Node refuses type
stripping under `node_modules`, so the build transpiles them to `.js` inside the
bundle and repoints their export maps. No repository source file is changed.

## Run it

On Linux/macOS:

```bash
tar -xzf denti-code-u3-server-0.1.3-linux-x64.tar.gz
cd denti-code-u3-server-0.1.3-linux-x64
./start.sh
```

On Windows, extract the `.zip`, then run `start.cmd`.

The launcher sets `DATABASE_URL` from its own directory, so the extracted folder
can be moved. It binds `API_HOST:API_PORT` from `.env.example` (default
`0.0.0.0:3010`), which is the URL compiled into the desktop installers. Leave
the window open while the app is in use; Ctrl+C stops the API. Every setting
except `NODE_ENV` can be overridden from the launching shell, for example
`API_PORT=3098 ./start.sh`; `NODE_ENV` is pinned to `production` so the
password-free development endpoints stay off.

Sign in with `admin@denti-code.test` and the password from the bundle README.
The other seeded accounts are `recepcion@`, `elena.vargas@` and
`marco.salas@denti-code.test`, all sharing it.

## Operational notes

- The server runs with `NODE_ENV=production`, so `/api/v1/auth/dev-users` and the
  password-free sign-in buttons are not registered (ADR 0030).
- Change the per-build bundle password in Settings before storing real patient data;
  [ADR 0042](./decisions/0042-password-change-and-first-admin-bootstrap.md) resolves
  the old open question.
- The seed fixes appointments relative to the build date. A bundle stored for
  months will show an old calendar.
- The API owns the database. Do not edit `data/denti-code-u3.db` from the desktop
  app or while the server is running.
- The archive is native to its build platform because of the bundled Node binary
  and the compiled `better-sqlite3` binding.

## Releases

Pushing a `v*` tag equal to the version in `tauri.conf.json` runs
`.github/workflows/release-desktop.yml`. In addition to the MSI and DEB, a Linux
and a Windows job build the server bundle and upload their archives to the same
draft release. Publishing the draft remains a human act (ADR 0038/0039).
