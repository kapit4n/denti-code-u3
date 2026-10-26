# ADR 0028 — Authentication is opaque bearer sessions, hashed at rest

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `database` (schema + migrations), `packages/domain` (auth use cases, roles), `packages/validation`, `packages/api-client`, `packages/app` (session, login), `apps/api` (auth plugin, routes, repositories), `database/seed.ts`, `e2e`
- **Relates to:** [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0008](./0008-single-react-application.md)

## Context

Milestone 12 is production hardening, and its first slice is authentication. Until
now the API trusted a `CLINIC_ID` from configuration and had no notion of a user:
every request was the clinic. That is not a foundation a real clinic can run on — it
cannot say who wrote a note, revoke a departed employee, or keep a receptionist out of
the odontogram.

Four questions had to be answered before code:

1. **What is a session?** A signed JWT, a server-side opaque token, or a cookie?
2. **How are passwords stored?** A native addon (bcrypt/argon2) or something already in
   the runtime?
3. **How is a route protected by default?** Per-route guards, or a global gate?
4. **Where does authorization live?** In components, in handlers, or in the domain?

## Decision

### 1. Opaque bearer tokens in a `sessions` table

Login returns a token: 32 random bytes, base64url. The API stores only the **SHA-256
hex digest** of the token in `sessions.token_hash`, with an index, and looks the
request's token up by that digest. The raw token exists only in the response and in the
client that holds it.

- Not a JWT: a JWT is verified locally, so revoking one before expiry needs a deny-list
  — a second store with the same job. A row lookup is one indexed query and revocation
  is a row.
- A SHA-256 digest, not scrypt, for the token: the token is 256 bits of full entropy,
  so there is no dictionary to slow down. The password is the low-entropy secret and
  gets the KDF.
- Bearer in the **response body**, not a cookie. The same client serves web, the Tauri
  desktop shell and future integrations; a cookie would make the web build special and
  bring CSRF into a REST API that otherwise does not need it. The cost is that the token
  is readable by page script, which is why the session is cleared on logout and on a
  401 from anywhere.

### 2. Passwords with `node:crypto` scrypt

`ScryptPasswordHasher` uses `crypto.scrypt` with `N=16384, r=8, p=1`, a per-password
random salt, and a self-describing value:

```
scrypt$16384$8$1$<base64 salt>$<base64 derived key>
```

Verification parses the stored parameters, refuses an unreadable value or absurd cost,
and compares with `timingSafeEqual`. `bcrypt` and `argon2` were rejected because both
are native addons: an install-time compile, a prebuilt-binary supply chain, and a
platform matrix, for a primitive Node already ships. The stored parameters mean the
cost can be raised later without a migration that re-hashes everything at once.

### 3. Sessions fail closed

`registerAuth` runs on `onRequest`. **Every route is authenticated unless it declares
`config: { public: true }`.** Only `/`, `/health`, `/ready` and `POST /auth/login` are
public. A new route that forgets a guard is therefore unreachable rather than open —
loud and safe. The old config-based `clinic-scope.ts` plugin is deleted; the auth plugin
sets `request.clinicId` and `request.principal`, and routes read those.

Session usability is decided in the domain (`resolvePrincipal` →
`assertSessionUsable` → `assertUserActive`): missing, revoked, expired or belonging to a
deactivated user all refuse. A failure is `UNAUTHENTICATED` (401 with
`WWW-Authenticate: Bearer`). The token's clinic must equal the configured clinic, so a
token can never reach another clinic's data.

Login refusals are identical for an unknown email, a wrong password, a deactivated user
and a user with no stored hash: one `UNAUTHENTICATED` ("The email or password is
incorrect"). There is no account enumeration. Email lookup is case-insensitive
(`lower(email)`).

### 4. Authorization is a domain matrix, enforced on the route

`packages/domain/src/organization/roles.ts` defines four roles and the permissions each
carries. It is pure data and pure functions; no React, no Fastify. The API enforces it:

- a route declares `config: { permission: 'billing:write' }` (or an array) next to its
  path;
- the auth plugin checks it after resolving the principal, before the handler runs;
- a missing permission is `FORBIDDEN` (403), deliberately distinct from the 401 that
  means "log in".

Declaring the permission on the route rather than inside the handler means a handler
cannot forget it. The UI may hide an affordance a role cannot use, but that is a
convenience; the API is the control.

Authorization is checked after authentication, so a 403 is only ever shown to a caller
who is actually signed in.

### 5. The session lives in one place on the client

`packages/app/src/features/auth` owns the session. `SessionProvider` reads/writes
`localStorage`, exposes the current user and `signIn`/`signOut`, and pushes the bearer
header into the shared `ApiClient` through `setAuthorizationHeaderGetter`. No feature
touches the token. A 401 from any query dispatches a `denti-code:unauthorized` event
(the query cache in `mount.tsx` does this); the provider clears the session and the
query cache, which re-renders the login screen. The root route gates the shell on
`isAuthenticated`, so a signed-out deep link shows login rather than an empty frame.

The session is validated on read (malformed JSON, missing fields and past expiry all
read as "no session"), and trusted until a request says otherwise — there is no blocking
`/auth/me` round-trip before the first screen.

## Consequences

- Every engine needs the same `sessions` table and the same `UserRepository`/
  `SessionRepository` methods (ADR 0025's "write it twice" continues to apply).
- Tokens expire after 12 hours by default (`SESSION_TTL_HOURS`, 1–720). A user who is
  signed out on all devices is a row update, not a deny-list.
- The raw token is in `localStorage`. XSS on the origin can read it; the mitigation is
  that the token is revocable and short-lived, not that it is hidden. A future
  `HttpOnly` cookie for the web target would be a new ADR, and would need CSRF.
- Login rate limiting arrived in the next slice: failed attempts are counted per email
  and client address in process (ADR 0029).
- The seed creates development users with the password `denti-code-dev`. It is
  development data, printed by the seed; it must never run against production.
- Per-route permissions are now part of the API surface. Adding a route means choosing
  its permission; a read of the route list tells you what a role can do.

## Alternatives rejected

- **JWT access tokens.** Revocation needs a second store, and the token grows with every
  claim.
- **bcrypt / argon2.** Native addons for a primitive in `node:crypto`.
- **A cookie session for web and a token for desktop.** Two auth paths, plus CSRF for
  the one path.
- **Per-route guards added by hand.** Fails open the first time someone forgets one.
- **Authorization in the React components.** The component is not a security boundary.
- **Storing the raw token.** A database read (or backup) would hand out live sessions.
- **Reusing scrypt for the token.** The token is high-entropy; a KDF per request buys
  nothing and costs latency on every call.
