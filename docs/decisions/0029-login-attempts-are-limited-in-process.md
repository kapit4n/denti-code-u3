# ADR 0029 — Login attempts are limited in process, per email and address

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `apps/api` (auth route, rate limiter, env), `packages/validation` (env), `packages/api-client` (error code), `packages/app` (login message), `e2e`, `.env.example`
- **Relates to:** [ADR 0028](./0028-authentication-is-opaque-bearer-sessions.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md)

## Context

ADR 0028 shipped authentication with an explicit gap: nothing slowed down password
guessing. The login response deliberately does not say whether an email exists, but
without a limiter an attacker can still try passwords indefinitely — an identical 401
per attempt is cheap to collect.

A limiter needs four decisions: what it keys on, what it counts, where the counter
lives, and what the caller is told.

## Decision

### 1. Key: normalised email **and** client address

The key is `lower(trim(email)) + "|" + request.ip`.

- **Not the account alone.** Keying on the email lets anybody lock a known member of
  staff out of their own account by failing five times on purpose. A busy clinic shares
  terminals; an ex-employee knows addresses.
- **Not the address alone.** A clinic behind one NAT is one address, so failures against
  any account would throttle every account for everyone in the building.
- Together they bound an attacker to the accounts they target from the machines they
  control, and a mistyped password on one terminal does not travel.

The address is `request.ip` with Fastify's `trustProxy: false`. A deployment behind a
reverse proxy must either configure trusted proxies per deployment or let the proxy own
rate limiting; otherwise every client appears as the proxy and the key behaves like
email-only. That is a deployment fact, documented rather than guessed at startup.

### 2. Count: failures only, cleared by success

- Only a `UNAUTHENTICATED` result from the domain use case increments the counter.
  Validation failures, database errors and bugs are not the person's fault and must not
  punish a correct password.
- A successful login deletes the key. The person who knows the password has already
  answered the question; making them wait after a typo would be hostile.
- The check runs **before** the credential check, so an exhausted window refuses even
  the right password. Otherwise a correct password would leak through the limiter.

### 3. Store: an in-memory fixed window, one per process

`LoginRateLimiter` is a Map of `{ failures, resetAt }` with a fixed window (default five
attempts per fifteen minutes, `AUTH_LOGIN_MAX_ATTEMPTS` /
`AUTH_LOGIN_WINDOW_MINUTES`). It is created once in `buildServer` and injected into the
auth routes.

- **Not the database.** The current deployment is one API process; a counter table would
  add two repository methods on both engines and a write on the unauthenticated login
  path, to protect state that is worthless after fifteen minutes.
- **Not Redis.** No such infrastructure exists in this project, and adding one for a
  transient counter violates "no premature abstractions".
- **Not a proxy-only rule.** A proxy is the right place for a deployment that has one,
  but the API must not be defenceless when it is exposed directly (development, a small
  clinic, the desktop shell in future).

The map is bounded (`maxKeys`, default 10 000). Expired entries are pruned when the
bound is crossed; if live entries still exceed it, the longest-tracked keys are evicted.
This is a memory safety valve, not an eviction policy to rely on.

Restarting the API clears the counters, which is acceptable for a brute-force speed
bump. Refusals are logged with the request id and address, never the email.

### 4. Answer: 429 with `Retry-After`

An exhausted window answers `429 RATE_LIMITED` with
`Retry-After: <seconds>` and the standard problem envelope. The client maps that code to
"Too many sign-in attempts. Try again later." rather than "The email or password is
incorrect." — a throttled operator must not keep retyping a correct password.

The limiter runs after body validation, so a malformed request cannot consume another
account's budget, and before the use case, so no hash is computed for a refused attempt.

## Consequences

- Single-instance deployments are covered without new infrastructure. A multi-instance
  deployment must move the counter to shared storage or enable proxy rate limiting;
  in-process counters are per instance and restart with the process.
- The limiter does not stop a distributed attack that varies both email and address.
  It raises the cost of the common case (one attacker, one account) and leaves broad
  abuse to the deployment layer.
- `AUTH_LOGIN_MAX_ATTEMPTS` and `AUTH_LOGIN_WINDOW_MINUTES` are now part of the env
  contract; changing them is configuration, not a deploy.
- `RATE_LIMITED` is a new stable API code in `problem.ts` and `API_ERROR_CODES`, so the
  client can distinguish throttling from bad credentials.
- The seed's development users remain usable for e2e because the limiter counts
  failures only; a successful login clears the key.

## Alternatives rejected

- **Per-email only.** Enables trivial account lockout denial of service.
- **Per-address only.** One shared clinic terminal would throttle the whole clinic.
- **A database-backed counter.** Two extra repository methods on two engines, plus a
  write on every failed login, for ephemeral state.
- **Redis or another external store.** New infrastructure for one counter.
- **Sliding window / token bucket.** More state and more code for a policy where the
  difference is immaterial at five attempts.
- **Locking the account after N failures.** Turns an attack into an outage and needs an
  unlock path; throttling the attempt is enough.
