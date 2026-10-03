# ADR 0015 — Patient record numbers are allocated by the server, per clinic, atomically

- Status: Accepted
- Date: 2026-10-03
- Decides: who assigns a patient's chart number, and how two simultaneous registrations are prevented from colliding

## Context

A patient needs a short number the front desk can read out over the phone and write
on a paper file: `P-000001`. Two properties are not negotiable.

It cannot be chosen by the client. The number identifies a chart. If a browser
could post one, it could post someone else's.

It cannot collide. Two receptionists registering at the same moment is ordinary
clinic traffic, not an edge case. If both read "the highest issued number is
P-000004", both compute P-000005, and the unique index rejects one of them — in
front of a patient who is already at the desk, holding a form that the software
just refused.

The collision is also not something to be caught and retried gracefully. Even
"retry and take the next number" leaves the receptionist watching a spinner,
because the failure happened after the transaction that would have made the retry
safe.

## Decision

The server allocates the number, inside the same transaction that inserts the
patient, under a transaction-scoped advisory lock keyed on the clinic.

```ts
await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${clinicId}))`);

const issued = await tx.execute(sql`
  SELECT record_number
  FROM patients
  WHERE clinic_id = ${clinicId}
    AND record_number ~ '^P-[0-9]+$'
  ORDER BY length(record_number) DESC, record_number DESC
  LIMIT 1
`);

const recordNumber = nextPatientRecordNumber(
  issued[0]?.record_number ? [issued[0].record_number] : [],
);
await tx.insert(patients).values({ ...patient, recordNumber });
```

The domain owns the _format_ (`nextPatientRecordNumber`, a pure function: highest
issued plus one, zero-padded to six digits, growing past a million rather than
wrapping). The domain does not own the _reservation_ — that is a concurrency
concern and belongs to infrastructure, behind a port.

The port is one method:

```ts
interface PatientRegistrationRepository {
  register(patient: Patient): Promise<{ readonly recordNumber: string }>;
}
```

The first version of this port was `save(patient, { recordNumber })` plus
`nextRecordNumber(clinicId)`. It was rejected for a reason worth recording: a port
that lets a caller drive those two calls separately cannot promise atomicity,
because no lock can span two independent calls. Pushing the transaction inside one
method is not a convenience — it is the only shape in which the guarantee is
expressible.

`pg_advisory_xact_lock` is transaction-scoped, so PostgreSQL releases it when the
transaction ends, including on an exception. A crashed request cannot wedge a
clinic's registrations. The key is derived from the clinic id rather than a fixed
constant, so two clinics in one database never block each other.

## Consequences

- A client cannot post a record number; the request schema does not accept one and
  a test asserts it never sends one.
- Numbers are sequential per clinic, so a clinic's charts are ordered by
  registration date for free.
- The unique index stays as the last line of defence rather than the mechanism.
  Its violation is mapped to a 409 rather than left as a 500 — see below.
- Legacy numbers are tolerated: the query filters to `^P-[0-9]+$`, so a clinic that
  imports data with its own numbering keeps registering. The sequence is `max + 1`,
  not a counter, so a gap left by an abandoned registration is not reused.
- **Reading a driver error is a trap.** Drizzle rethrows failures wrapped in its own
  `DrizzleQueryError` with the original moved to `cause`, so
  `(error as { code }).code` is `undefined` for every real database error and a
  duplicate silently becomes a 500. `isUniqueViolation` walks the cause chain and
  `apps/api/test/unique-violation.test.ts` builds its fixtures from the _wrapped_
  shape, because the obvious implementation passes a test written against a bare
  `{ code }` and fails in production.
- The concurrency guard needs a test that can actually fail. The first version
  passed against code with the lock removed, because the pool was `max: 1` and the
  driver serialised the transactions. The pool has to be wider than one for the
  race to exist.
- Numbers are not reused after a deletion. If a clinic's privacy workflow ever
  requires renumbering to hide a gap, that is a different feature with different
  rules, and it is not this one.

## Alternatives considered

- **A PostgreSQL `sequence`, or a per-clinic counter table.** Rejected: a plain
  sequence is global, so numbers would not restart per clinic, and a counter table
  means an extra row and an extra lock to keep in step with `patients`. `max + 1`
  under an advisory lock needs no new structure and is derived from the data that
  is already authoritative.
- **Let the client generate the number.** Rejected: it can be chosen, and it
  cannot be made sequential.
- **`save` plus `nextRecordNumber` on the port.** Rejected: see above. The caller
  can separate the two calls, so atomicity is not part of the contract.
- **Catch the unique violation and retry with the next number.** Rejected as the
  primary mechanism: it makes the common case a failure the user sees. The lock
  removes the race; the mapped 409 exists for the case where something outside this
  repository wrote to the table.
