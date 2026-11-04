# ADR 0036 — A treatment-plan item is the cross-visit treatment

- **Status:** Accepted
- **Date:** 2026-11-04
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `packages/domain`, `apps/api`, `packages/app`, `e2e`
- **Relates to:** [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0025](./0025-sqlite-is-the-default-engine.md)

## Context

A treatment that takes more than one visit had no place to say so. A visit treatment
record already carried an optional `treatmentPlanItemId`, but it was treated only as
provenance: the plan screen could not see the record, and the visit screen could not see
what had happened on earlier visits. A clinician continuing a root canal therefore had
to remember the prior work, and the plan's line stayed "pending" until somebody marked
it done.

The domain already has the two facts needed: the planned line is the assigned work, and
each visit treatment linked to it is one session of that work. The missing piece was a
read shape and a visit-screen workflow, not a new scheduling model.

## Decision

### 1. The plan item is the cross-visit unit

A treatment-plan item is the treatment the clinic has offered the patient. Every
`visit_treatment_executions` row that names it is one session of that treatment, on the
visit it names. There is no separate "visit assignment" table and no new session table:
the existing optional link is the association, and the execution row is the session.

A plan item may have zero, one or many sessions. A completed item keeps its sessions as
history. An unplanned treatment remains possible and is simply a record with no
`treatmentPlanItemId`.

### 2. The plan read carries the sessions

`GET /api/v1/patients/:patientId/treatment-plans` answers each item with its sessions,
oldest first. A session carries its record id, visit id, tooth, notes, performed time
and end time. No new endpoint is added: the visit screen already needs the patient's
plans for the optional line picker, so attaching the history to that answer avoids a
second round trip and a second scoping rule.

The sessions are read from the execution side, scoped by clinic and patient. The plan's
stored rows do not gain a counter, a status or a denormalised last-visit field.

### 3. Progress in the visit screen is derived from sessions

The visit screen lists the patient's open planned lines. A line with sessions reads
**In progress**; one without reads **Not started**. The line's stored `isCompleted` is
still the only completion truth, and the plan read still computes the plan's aggregate
progress from it. The visit screen does not write a progress status.

### 4. Completion stays explicit

Recording or finishing a session never marks the planned line done. The visit screen
offers a separate **Mark done** action that calls the existing item-completion endpoint.
This keeps clinical completion a deliberate act: a multi-visit treatment can end a visit
without claiming the whole treatment is finished.

Starting or continuing a line pre-fills the treatment form with the line's treatment,
tooth and id. The record remains a normal visit treatment, with its own finish time and
supplies.

The plan read is invalidated after a linked record is created or finished, because the
same record is now part of the line's session history.

## Consequences

- A clinician can see where a multi-visit treatment stands before starting today's
  session, and can continue it without retyping the treatment and tooth.
- The plan screen and the visit screen agree about the line: neither stores a second
  completion flag and neither guesses a session count.
- The optional link becomes the load-bearing association, so removing it later would be
  a data migration rather than a UI change.
- The plan answer grows with the patient's treatment history. A plan with many sessions
  sends them with every plan read; pagination or a per-line history read is a later
  decision if that becomes large.
- No schema change is required. Both engines already store the link, so PostgreSQL and
  SQLite keep the same write model (ADR 0025).

## Alternatives rejected

- **A dedicated visit-treatment assignment table.** It would duplicate the plan item's
  treatment, tooth and quantity, and create a second thing to keep in sync.
- **A separate session entity with its own table.** A session is the visit treatment
  record; a second row for the same work would make the record and the session disagree.
- **Auto-completing the plan item when a session finishes.** It conflates one visit's
  work with the whole treatment and removes the clinician's explicit decision.
- **A new `GET .../treatment-plan-items/:id/sessions` endpoint.** The visit screen
  already reads the plans; a second read would duplicate patient scoping and add a
  loading state for data the plan answer can carry.
- **A stored "in progress" status on the item.** It would be another field to update on
  every session and another chance to disagree with the sessions themselves.
