# Denti-Code U3 — Database Architecture

Persistence strategy: PostgreSQL only, via Drizzle ORM
([ADR 0003](./decisions/0003-postgresql-only-for-now.md)).

---

## 1. Ownership

**Only `apps/api` touches the database.** The web app, the desktop app and the
domain never connect to PostgreSQL; they go through the REST API. This is
enforced by `pnpm run guard:boundaries` (only `apps/api` and `database/` may
import `drizzle-orm`/`postgres`).

```
React (web/desktop) → api-client → REST → apps/api use cases
       → domain ports → Drizzle repositories → PostgreSQL
```

## 2. Layout

```
database/
├── schema/            Drizzle schema, one file per bounded area
│   ├── identity.ts        clinics, users, staff, dentists, rooms, chairs
│   ├── patient.ts         patients, allergies, medical conditions
│   ├── appointment.ts     appointments
│   ├── visit.ts           visits, clinical notes, attachments
│   ├── odontogram.ts      odontogram entries
│   ├── treatment.ts       treatments, plans, plan items, records, prescriptions
│   ├── billing.ts         invoices, charges, payments, allocations
│   ├── inventory.ts       items, stock movements
│   ├── enums.ts           shared pgEnum definitions
│   └── index.ts           re-export barrel used by the API + migration tooling
├── migrations/        generated SQL + meta journal
├── seeds/             development seed data
├── migrate.ts         migration runner (tsx)
└── seed.ts            seed runner (tsx)
```

`database/` is a **tooling + schema** package, not a runtime dependency of the
frontend. `apps/api` imports the schema module for its Drizzle client and for
type inference; nothing else does.

## 3. Conventions

| Concern                         | Convention                                                                                                                                                                                                       | Rationale                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **IDs**                         | `uuid` primary keys, `defaultRandom()` generated in the DB                                                                                                                                                       | Client- and server-generated ids, no enumeration, merge-friendly                             |
| **Timestamps**                  | `timestamptz` (`withTimezone: true`) everywhere; never naive local times                                                                                                                                         | Timezone correctness for scheduling                                                          |
| **createdAt / updatedAt**       | NOT NULL, set by the DB default and updated by Drizzle `$onUpdate`                                                                                                                                               | Consistent audit basics                                                                      |
| **Soft delete**                 | `deleted_at timestamptz` on patient-facing records (patients, appointments, visits)                                                                                                                              | Clinical history must not vanish; `is_active` used where "deactivated" is the true meaning   |
| **Audit fields**                | `created_at`, `updated_at` now; `created_by_user_id` / `updated_by_user_id` where authorship matters (visits, notes)                                                                                             | Auditability without a full audit log yet                                                    |
| **Clinic**                      | `clinic_id` FK on every table, indexed                                                                                                                                                                           | Clinic is a first-class concept; multi-clinic is a filtering change later                    |
| **Patient**                     | `patient_id` FK with a supporting index                                                                                                                                                                          | Patient is the primary axis of almost every query                                            |
| **Appointment**                 | `starts_at timestamptz`, `duration_minutes int`, composite index `(clinic_id, starts_at)`                                                                                                                        | Agenda range queries are the hottest path                                                    |
| **Money**                       | `integer` minor units (cents) + `currency char(3)`                                                                                                                                                               | Never floats; exact arithmetic                                                               |
| **Enums**                       | PostgreSQL `pgEnum` for closed, domain-owned sets (appointment_status, visit_status, …)                                                                                                                          | Invalid states become impossible at the storage layer, not just in code                      |
| **Naming**                      | `snake_case` tables/columns (Drizzle maps to `camelCase` in TS)                                                                                                                                                  | SQL-idiomatic storage, idiomatic TS                                                          |
| **Free-form clinical payloads** | `jsonb` only where the shape is genuinely open (settings, snapshot payloads)                                                                                                                                     | Resist premature structure; clinical detail is structured                                    |
| **Soft delete queries**         | Repositories filter `deleted_at is null` explicitly                                                                                                                                                              | No implicit global scope magic                                                               |
| **Transactions**                | Multi-row invariants run in one Drizzle transaction via the `UnitOfWork` port                                                                                                                                    | Correctness of billing and visit creation                                                    |
| **Patient record numbers**      | `text`, assigned by the server in the inserting transaction under `pg_advisory_xact_lock`, unique per `(clinic_id, record_number)` ([ADR 0015](./decisions/0015-patient-record-numbers-are-server-allocated.md)) | A client must not choose a chart number, and two simultaneous registrations must not collide |

Explicitly **not** adopted: soft-delete global scopes, ORM active-record
patterns, JSON columns as a substitute for modelling, and denormalised counters
that can drift (dashboard "pending treatments" is a projection, not a column).

## 4. Core schema (Phase 1 subset)

The foundation phase implements only what is needed to prove the conventions and
support the first vertical slice. The full catalogue from `docs/domain.md` is
scheduled per milestone.

| Table                                                       | Notes                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `clinics`                                                   | tenant root; name, timezone, currency, settings (jsonb)                          |
| `users`                                                     | identity + auth boundary; `clinic_id`, email (unique per clinic), role, `status` |
| `staff`                                                     | clinic-scoped role of a user                                                     |
| `dentists`                                                  | clinical profile (specialties, default chair)                                    |
| `rooms`, `chairs`                                           | physical resources; chairs belong to a room                                      |
| `patients`                                                  | identity + contact + soft delete                                                 |
| `appointments`                                              | scheduling with status enum, duration, chair/dentist/patient FKs                 |
| `visits`                                                    | clinical interaction; links appointment, patient, dentist; status enum           |
| `clinical_notes`                                            | typed notes per visit                                                            |
| `odontogram_entries`                                        | per-tooth state; unique per (patient, dentition, tooth)                          |
| `treatments`                                                | service catalogue                                                                |
| `treatment_plans` / `treatment_plan_items`                  | proposals with sequence                                                          |
| `treatment_records`                                         | what was performed, per visit                                                    |
| `prescriptions`                                             | per visit                                                                        |
| `invoices` / `charges` / `payments` / `payment_allocations` | commercial                                                                       |
| `inventory_items` / `stock_movements`                       | stock                                                                            |

## 5. ER overview

```
clinics ──┬── users ─── staff ─── dentists
          ├── rooms ─── chairs
          └── patients ──┬── appointments ─── visits ──┬── clinical_notes
                          │        │                   ├── odontogram_entries
                          │        └── visit_id        ├── treatment_records
                          ├── appointments (dentist, chair)
                          └── invoices ── charges ── payments ── payment_allocations

treatment_plans ── treatment_plan_items ── treatments
visits ── prescriptions
inventory_items ── stock_movements
```

## 6. Migrations

- Generated with `drizzle-kit generate` into `database/migrations/` (SQL + JSON
  journal), so the migration history is reviewable in git.
- Applied with `pnpm run db:migrate` (`database/migrate.ts`), which reads the
  journal and applies pending migrations in order inside a transaction, with a
  Drizzle migration table tracking what has run.
- No automatic schema mutation at API boot: schema changes go through
  migrations, always.
- Seed data (`pnpm run db:seed`) is idempotent and clearly marked development-only.

## 7. Development database

`docker-compose.yml` provides PostgreSQL 17 for local development:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment: POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
    ports: ['5433:5432'] # non-default host port to avoid clashing with other local DBs
    volumes: [denti-postgres-data:/var/lib/postgresql/data]
    healthcheck: pg_isready
```

- Host port **5433** is deliberate: a default `5432` collides with other local
  PostgreSQL instances on a developer machine. Configure `DATABASE_URL` to match.
- A persistent named volume keeps data across restarts; `pnpm run db:reset`
  drops and recreates for a clean slate.
- Production databases are managed separately; no production connection string
  is ever committed.

## 8. Queries and performance

- Agenda: range scan on `(clinic_id, starts_at)` with `>= from AND < to`.
- Patient search: `ILIKE` on name/phone/id plus a `pg_trgm` GIN index on the
  searchable text (Phase 2, when search ships).
- Every list query is paginated (`LIMIT`/`OFFSET` in Phase 1; keyset pagination
  if a screen needs it).
- N+1 is avoided with Drizzle's relational queries (`db.query.X.findMany({ with })`)
  rather than ad-hoc loops.

## 9. Safety

- Drizzle builds parameterized queries; no string-built SQL anywhere (guard +
  lint). SQL injection is structurally prevented.
- Foreign keys with sensible `onDelete`: `restrict` for clinical/financial
  history, `cascade` only for owned child rows (e.g. `treatment_plan_items`).
- Constraints encode invariants that must hold regardless of the application
  (e.g. `duration_minutes > 0`, `end > start` where applicable, unique
  constraints on natural keys).
- **Scheduling overlaps are rejected by PostgreSQL, not by the application.**
  Three GiST exclusion constraints (per dentist, chair and room) compare
  `[starts_at, appointment_ends_at(starts_at, duration_minutes))` as half-open
  ranges, so two simultaneous requests cannot both win and no import script can
  bypass it. `btree_gist` is what lets a plain `uuid` be compared inside a GiST
  index.

  The end time is computed, never stored. A `GENERATED ALWAYS AS` column is
  rejected by PostgreSQL because `timestamptz + interval` is `STABLE`, not
  `IMMUTABLE`; a trigger-maintained column would have to be hidden from the
  Drizzle schema, which makes `drizzle-kit push` a threat to the constraint
  itself. Declaring the expression `IMMUTABLE` in a function removes the problem.
  `IMMUTABLE` is valid here only because the offset is minutes: a day or month
  component is time-zone dependent. Full reasoning in
  `docs/decisions/0012-appointment-end-time-is-computed-never-stored.md`.

## 10. What is not here yet

No partitioning, no read replicas, no connection pooling beyond a sane
postgres.js pool, no row-level security, no multi-tenant enforcement beyond the
`clinic_id` column, no audit-log table, no soft-delete global scope. These are
considered when the product actually needs them (see `docs/roadmap.md`,
Milestone 12).
