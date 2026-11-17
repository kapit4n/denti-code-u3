# ADR 0042 — Password change and first-admin bootstrap resolve T10

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decides:** how the generated password from ADR 0040/0041 is rotated, and how a real database gets its first administrator
- **Related:** [ADR 0028](./0028-authentication-is-opaque-bearer-sessions.md), [ADR 0030](./0030-development-login-as-is-gated-by-route-existence.md), [ADR 0040](./0040-server-bundle-with-initial-data.md), [ADR 0041](./0041-desktop-installer-embeds-local-clinic-server.md)

## Context

ADR 0040 and ADR 0041 generate an administrator password at build time. It is printed
in the standalone bundle README or shown once by the desktop login screen. That is a
safe initial credential, but it is still a credential the installer author knows, and
open question T10 has no answer: there is no password-change screen, no registration
endpoint and no procedure for provisioning the first administrator in a database that
was not seeded by a development script.

A real clinic needs to rotate that password before storing patient data. An operator
setting up a fresh PostgreSQL database needs a first administrator without adding a
public sign-up endpoint. The existing `users.password_hash` column already holds a
self-describing scrypt hash, and every authenticated request already carries a
resolved principal, so this can be a small authenticated self-service write plus a
one-shot local CLI.

## Decision

1. **Authenticated self-service password change.** `POST /api/v1/auth/change-password`
   accepts `{ currentPassword, newPassword }` from any authenticated user. The route
   has no clinic permission because a person may change their own password; the user
   id always comes from `request.principal`, never from the body. A wrong current
   password refuses with the same `UNAUTHENTICATED` message as any other bad
   credential, and the existing login limiter counts attempts by principal.

2. **Passwords are at least 12 characters.** The rule is enforced in the domain use
   case and the wire schema, matching the build-time policy already used by
   `bundle:server` and `bundle:desktop-server`. Passwords are never trimmed; spaces
   are valid characters.

3. **Changing a password does not revoke other sessions.** The current session stays
   usable, so the operator is not logged out mid-edit, and the existing session
   repository needs no new verb. "Sign out everywhere" remains a separate product
   decision; this ADR does not claim it exists.

4. **First-admin provisioning is a local CLI.** `pnpm db:bootstrap-admin --email … --password …`
   creates the clinic named by `CLINIC_ID` (and `CLINIC_NAME` / `CLINIC_TIMEZONE`
   when present) if the clinic row does not exist, then inserts one `ADMINISTRATOR`
   user with a scrypt hash. It refuses to run when the clinic already has any user,
   so it can never silently reset an existing password. It is not an HTTP endpoint.

5. **Bundles keep their generated password as a bootstrap credential.** The desktop
   banner and bundle README now tell the operator to rotate it in Settings. No
   default password is committed to source; `denti-code-dev` remains only for the
   unseeded development workflow.

6. **No self-registration, reset email or temporary-link flow.** Those need product
   decisions about identity verification and are explicitly out of scope.

## Rationale

The smallest complete answer to T10 is one authenticated write for rotation and one
operator-run command for first provisioning. Both reuse the security primitives
already verified by the authentication suite. Rejecting a second bootstrap makes the
CLI safe to keep in a runbook: it is idempotent in intent only in the sense that the
second call fails loudly rather than changing anything.

Keeping the current session alive avoids a surprise logout on the same screen where
the operator just changed the password. Other sessions remain valid until expiry,
which is documented rather than hidden; adding revocation would need a new
repository method in both engines and its own decision.

## Consequences

- A new `UserRepository` method updates the password hash and `updated_at` in both
  SQLite and PostgreSQL; the insert-only `save` is unchanged.
- The API gains one authenticated route and the app gains a password card in Settings.
- The bootstrap CLI duplicates no hashing logic: the seed and the CLI share one
  helper under `database/`, still with no dependency on `apps/api`.
- The generated installer credential remains a real password until rotated; the UI
  warns about it, but nothing forces rotation.
- Password reset, user provisioning for additional staff and sign-out-everywhere
  remain out of scope and need their own decisions.
