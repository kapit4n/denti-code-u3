# ADR 0030 — Development login-as is gated by route existence

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `apps/api` (dev auth routes, auth plugin, user repository), `packages/domain` (session issuance, user port), `packages/validation`, `packages/app` (login chooser, session), `e2e`
- **Relates to:** [ADR 0028](./0028-authentication-is-opaque-bearer-sessions.md), [ADR 0029](./0029-login-attempts-are-limited-in-process.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md)

## Context

Testing the clinic app means being a receptionist, a dentist and an administrator in
quick succession. The seed prints one password for every user, so a tester can log in
normally — but switching roles by retyping `denti-code-dev` is friction, and a browser
spec that only ever runs as the administrator never sees the permission differences
the product exists to enforce.

A "sign in as" shortcut is therefore useful, and it is also the most dangerous thing in
the authentication surface: a password-free door into any active account. The design
question is not whether to have one, but how to make it **impossible in production**
rather than merely discouraged.

## Decision

### 1. The gate is route existence, not a flag

`buildServer` registers the development routes only when `NODE_ENV !== 'production'`.
In production they are not in the route table at all.

- **Not an `AUTH_DEV_LOGIN=true` flag.** A flag can be left on in a copied `.env`, and
  the failure is silent. A route that was never registered cannot be enabled by
  configuration.
- **Not a `VITE_` client flag.** The client is not a security boundary. The server decides
  whether the door exists; the UI simply asks.
- `NODE_ENV` is already the deployment's statement of intent and is validated at boot.
  A deployment that labels itself `development` gets development affordances, which is
  the honest meaning of that label.

### 2. Two public endpoints, both absent in production

- `GET /api/v1/auth/dev-users` returns `{ items: AuthenticatedUser[] }` for the clinic,
  **active users only**, ordered by name. It uses the safe projection — no password hash
  has a field to hide in.
- `POST /api/v1/auth/dev-login` takes `{ userId }`, validated as a UUID, and returns the
  same body as the normal login (`token`, `expiresAt`, `user`).

Both are `config: { public: true }` because their whole purpose is to be reachable before
a session exists. The login rate limiter does not apply to `dev-login`: the endpoint is
not guessing a password, and counting it would only make testers wait.

### 3. The shortcut skips the password, never the account rules

`startSessionForUser(clinicId, userId, deps)` in the domain finds the user by id, refuses
an unknown or inactive account with `UNAUTHENTICATED`, then calls the same private
`issueSession` the normal login uses. There is one place that mints a token, stores its
SHA-256 digest, applies the session TTL and stamps `last_login_at`.

A development session is a **real** session: it appears in the `sessions` table, is
accepted by `resolvePrincipal`, expires normally and is revoked by logout. Nothing
downstream knows it was issued without a password.

### 4. The client asks; the server answers with presence

`LoginPage` queries `/auth/dev-users` (retry disabled — a production 404 is expected, not
a failure) and renders the chooser only when a non-empty list arrives. A production build
therefore makes one request, receives 404 and shows the normal form. There is no build
flag to drift from the server's truth.

Selecting a user calls `SessionProvider.signInAs(userId)`, which stores the returned
session through the same `acceptSession` path as the password form, so header injection,
storage and 401 handling cannot diverge between the two doors.

### 5. An unmatched path answers 404 without authentication

The auth hook now returns early when `request.routeOptions.url` is undefined. Without
that, a route that does not exist was answered with 401 (the hook ran and found no
token), which would make the production login page treat an absent dev route as an
expired session and dispatch the unauthorized event. "No such route" is not an
authentication failure; the not-found handler owns that answer.

### 6. Use is visible in the log

Every dev sign-in logs a warning with the request id and user id. It is not an audit
trail, but it is enough for a developer or operator to notice the door being used.

## Consequences

- Production has no `dev-users`/`dev-login` route and no flag to flip; a mistaken
  `NODE_ENV=development` in production exposes both, so the deployment must set
  `NODE_ENV=production` (already required for JSON logs).
- Staff emails and names of **active** users are readable by anyone who can reach a
  non-production API. It is test data, and the route does not exist in production.
- A dev session bypasses the password by design; it does not bypass inactivity, expiry,
  revocation or permissions. Signing in as a receptionist still gets 403 on a treatment
  write.
- The user port gained `listByClinic`, implemented on both engines (ADR 0025).
- The chooser is not rate-limited; it is not guessing anything. Removing it from a
  shared development deployment is a matter of running that deployment as production.
- `e2e` covers the chooser against the mock API; API integration tests cover the routes
  in `NODE_ENV=test` and assert they answer 404 under `NODE_ENV=production`.

## Alternatives rejected

- **An env flag (`AUTH_DEV_LOGIN`).** Can be left on silently; route existence cannot.
- **Teaching the normal login a "no password for @denti-code.test" rule.** A
  production-shaped weakness in the real login path, guarded by data rather than by the
  build.
- **Client-only buttons that call the normal login with the seeded password.** Couples
  the UI to the seed, still needs the password in the bundle, and works in production.
- **Administrator impersonation only.** Needs an existing session, an audit trail and a
  "return to myself" model — a product feature, not a test shortcut.
- **A separate test-only binary.** More moving parts than a condition at registration.
