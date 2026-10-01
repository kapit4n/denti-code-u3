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
