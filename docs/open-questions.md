# Denti-Code U3 — Open Questions

Questions that need product or legal input. Each has the simplest reasonable
assumption in place, so work is never blocked.

| #   | Question                                                  | Assumption in place                                                           | Impact if wrong                     | Needed by           |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- | ------------------- |
| 1   | Single clinic or true multi-tenant from day one?          | `clinic_id` on every table; single clinic enforced by configuration           | Auth and query scoping rework       | Milestone 12 (auth) |
| 2   | Tooth notation standard?                                  | FDI ("18", "51")                                                              | Odontogram data model + UI          | Milestone 7         |
| 3   | Price catalogue: global, per clinic, or per dentist?      | `treatments.price` as a clinic-level default, overridable per record          | Billing model                       | Milestone 9         |
| 4   | Fiscal/invoice requirements (country, numbering, taxes)?  | Integer minor units + ISO currency; simple sequential numbering               | Invoice compliance                  | Milestone 9         |
| 5   | Currency and timezone per clinic?                         | `clinics.timezone` / `clinics.currency` columns, single value each            | Agenda + billing correctness        | Milestone 5         |
| 6   | Late arrivals / no-show analytics?                        | Statuses only; no separate late flag                                          | Dashboard "occupancy rate" accuracy | Milestone 3         |
| 7   | Clinical data retention, anonymisation, consent records?  | Soft delete only; no retention automation                                     | Compliance/privacy posture          | Milestone 12        |
| 8   | Target OS matrix for desktop?                             | Linux, Windows, macOS; Linux is the primary dev platform                      | Packaging/CI strategy               | Milestone 12        |
| 9   | Languages / locales / timezone display preferences?       | English UI, clinic timezone for scheduling, dates formatted per clinic locale | Formatting everywhere               | Milestone 3         |
| 10  | Are radiographs/images in scope, and how are they stored? | Attachments referenced by visit; storage unspecified                          | Storage infra + desktop file access | Milestone 6         |
| 11  | Appointment granularity for multiple chairs per dentist?  | One chair per appointment                                                     | Agenda model change                 | Milestone 5         |
| 12  | Recurrence (recurring appointments / treatment sessions)? | Not modelled                                                                  | Agenda + planning                   | After Milestone 8   |
| 13  | Patient self-service portal?                              | Not in scope                                                                  | New shell + auth surface            | Future              |
| 14  | Does the clinic need insurance/third-party payer support? | Not modelled                                                                  | Billing model                       | Future              |
| 15  | Audit-log requirements?                                   | `created_at`/`updated_at`/actor ids only                                      | Compliance posture                  | Milestone 12        |

**Rule:** do not build any of these speculatively. Resolve them at the milestone
where they become blocking, and write an ADR if the answer changes an
architectural decision.

---

## Technical open questions

These need a decision but do not need product input. Each has a working
assumption in place, so nothing is blocked.

| #   | Question                                                                          | Assumption in place                                                                                                                                                                                                                                              | Resolved by                                                                                            |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| T1  | Single-clinic scope comes from `CLINIC_ID` in configuration.                      | Scoped per request in `apps/api/src/http/plugins/clinic-scope.ts`; the API refuses to boot without it. Proven per route by integration tests, but still one clinic per process.                                                                                  | Authentication (Milestone 12) must replace the config lookup with a session check.                     |
| T2  | File-route **search params are typed `any`** in the app.                          | List state is component state and query types are explicit. The installed `@tanstack/router-plugin` 1.167.x emits no `Register` augmentation that `@tanstack/router-core` 1.171 reads, and the generated route tree carries `@ts-nocheck`, so the gap is silent. | Upgrading `@tanstack/router-plugin` to match the router-core version. Do not paper over it with casts. |
| T3  | Is `pnpm run build` still green after M3/M4?                                      | Typecheck, lint, format, unit and integration suites are all green; the build was deferred at the user's request for speed.                                                                                                                                      | Run `pnpm run build` and `pnpm run test:e2e` before signing off M3/M4.                                 |
| T4  | Dashboard browser verification is a throwaway script.                             | Pages were verified by hand in headless Chromium with a clean console. Nothing prevents regression.                                                                                                                                                              | Promote to committed Playwright specs in the same milestone.                                           |
| T5  | Occupancy assumes capacity = active dentists × open hours, minus the lunch break. | Derived from `clinic_operating_hours` and active dentists; `null` (rendered "—") when unknown. Ignores chairs, rooms and per-dentist schedules.                                                                                                                  | Milestone 5 (agenda) and the chair/room model.                                                         |
| T6  | Patient balance is charges − payments, and excludes tax.                          | `charges.tax_rate_percent` is not applied, so the balance will disagree with a tax-inclusive invoice once billing ships.                                                                                                                                         | Milestone 9 (billing) must define the authoritative balance rule.                                      |
