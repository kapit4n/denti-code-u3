# ADR 0031 — The visit directory is one page, scoped to the caller

- Status: accepted
- Date: 2026-10-28
- Amends: [0023](0023-visit-read-side-is-two-endpoints.md) Decision 1 (which declined a
  collection endpoint)
- Decides: what `GET /api/v1/visits` answers, who sees which rows, and why this list is
  paged when a patient's timeline is not.
- Related: [0014](0014-clinic-scoping-is-explicit.md) (a visit another clinic holds does
  not exist), [0028](0028-authentication-is-opaque-bearer-sessions.md) (roles and
  sessions), [0030](0030-development-login-as-is-gated-by-route-existence.md) (how the
  rows are exercised by hand).

## Context

The shell's **Visits** link has pointed at `/visits` since the sidebar was built, and
until now that path answered 404. ADR 0023 declined a collection endpoint on the grounds
that no question about visits needed a window and a set of filters. That reasoning was
about a _scheduling_ collection and it still holds: nothing here filters by date, chair
or status.

What was missing is a different question: **"which visits exist in this clinic?"** A
clinician wants their own recent work; the manager wants the clinic's. The patient
timeline cannot answer either, because it starts from a patient the reader already
chose. The product asked for the list, so the absence of a caller ended.

Who "the clinic's visits" means is not uniform. A clinician is attributed to every visit
they hold through `visits.dentist_id`; the login is one hop away, because `users` and
`dentists` are separate rows joined by `dentists.user_id`. A manager is not attributed
to visits at all — their role is the clinic.

## Decision 1 — One endpoint, one page at a time

`GET /api/v1/visits?page=&limit=`, requiring `visits:read`. The default is 20 rows and
the ceiling is 100, so `?limit=` cannot ask for the whole clinical record in one
request. The answer carries the exact total and `totalPages`.

This is the difference from ADR 0023's timeline: **a clinic-wide list grows forever,
while one patient's history does not.** Paging here is not a truncation the reader has
to guess at — the total is in the envelope, so "page 2 of 7" is a true sentence. The
patient timeline stays uncapped and its rule is unchanged.

Ordering is `coalesce(started_at, created_at)` descending, then `id` descending as a
tiebreak. A walk-in may be written with no start; an ordering that dropped those rows to
an arbitrary end would make a directory that looks shuffled. This is deliberately the
profile query's ordering rather than the timeline endpoint's `started_at`-only ordering:
the directory is a record of rows, not a clinical narrative of treatment.

## Decision 2 — The scope is the caller's, decided in the domain

`listVisitsForActor` takes the principal and the page request, not a `dentistId` query
parameter:

- `DENTIST` — resolves `dentists.user_id = principal.userId` in this clinic and lists
  only that clinician's visits. A login with no clinician row answers an **empty page**,
  not an error: the account may ask, but there is no clinician whose visits these are.
- `ADMINISTRATOR` — every visit in the clinic. This is the "manager" in the product's
  words.
- `RECEPTIONIST`, `ASSISTANT` — every visit in the clinic, for now. The same permission
  (`visits:read`) already let both roles open any visit by id, so narrowing the list
  would invent a barrier the detail route does not enforce. Recorded as an **open
  question** in `docs/open-questions.md`: whether front-desk roles should see all
  clinicians' visits or only the ones they started (a column the schema does not have).

Crucially, this is a **default view, not a new read barrier**. `GET /visits/:visitId`
remains scoped by clinic and permission exactly as ADR 0023 decided; a receptionist
following a link from a patient's profile still opens that visit. The list answers
"which visits would you like to work through", not "which visits are you allowed to
know exist".

## Decision 3 — Names travel with the row

`VisitListEntry` carries `patientName` and `dentistName`, joined on `(id, clinic_id)` so
a name from another clinic cannot appear on this one's row. A list screen that fetched
each row's patient and clinician separately would be an N+1 over a directory, and the
first page would already be forty requests.

`dentistId`/`dentistName` are nullable because a visit can outlive the clinician's
departure (ADR 0018's rule for the agenda, applied to the same column). The screen draws
"Unassigned" rather than inventing a name.

## Decision 4 — No filters yet

No date range, no chair, no status, no search. Every one of those needs a caller and a
screen control; adding them now would repeat the mistake ADR 0023 declined, only with a
different label. The page and the clinic scope are the whole query.

## Consequences

- ADR 0023's Decision 1 is amended: `GET /api/v1/visits` now exists, while its rejection
  of a filterable scheduling collection stands. Its Decision 2 (uncapped patient
  timeline) is untouched.
- `VisitRepository.listForClinic` is written twice (PostgreSQL and SQLite), as rule 16
  requires; both join the same three tables in the same order and use the same
  `coalesce`.
- `DentistRepository.findByUserId` exists for the scope lookup. It is clinic-scoped, so
  a user id from another clinic resolves to `undefined`.
- The sidebar's `/visits` link has a screen. The workspace route remains a sibling
  (`visits_.$visitId.tsx`), which is why the directory is `visits.tsx` rather than a
  folder.
- The directory shows the clinician on every row, so a manager can tell whose visit is
  whose and a clinician sees the same column rather than a screen with a blank one.
