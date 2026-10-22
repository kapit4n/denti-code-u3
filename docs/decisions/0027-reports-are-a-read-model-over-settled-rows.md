# ADR 0027 — Reports are a read model over the rows the clinic already keeps

- **Status:** Accepted
- **Date:** 2026-10-22
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `apps/api` (application read store, HTTP route), `packages/validation`, `packages/app` reporting feature, `packages/ui` (reused `Table`)
- **Relates to:** [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0017](./0017-agenda-overlap-and-clipped-capacity.md), [ADR 0026](./0026-inventory-is-an-append-only-ledger.md)

## Context

Milestone 11 asks for a reports screen: appointments, production, collections,
occupancy and dentist performance, with date/clinic/dentist filters and an export.
The data already exists — appointments, charges, invoices, payments and the clinic's
opening hours — but nothing assembled it into a period view.

Three questions had to be answered before any code:

1. **Is there a second store?** A reporting table or a nightly aggregate would make
   the screen fast and the numbers _wrong_ the moment a charge is corrected. The
   clinic's own rows are the record; a report is a way of reading them.
2. **What is a period, as a date?** A manager picks "October", which is the clinic's
   October. The database stores instants in UTC.
3. **What can honestly be attributed to a clinician?** Appointments carry a
   `dentist_id`; charges reach a clinician through their visit; payments carry none.

## Decision

### 1. One read-model port, two engines, no second store

`ReportsReadStore` (`readClinicSettings`, `readAppointmentBreakdown`,
`readProductionByDentist`, `sumPaymentsInWindow`, `sumOutstanding`,
`readOperatingHours`) is implemented once per engine and wired onto the connection
beside `DashboardReadStore` (ADR 0025). No aggregate table, no materialised view, no
scheduled job. Every figure is computed at read time from the rows the clinic writes,
so correcting a charge corrects the report on the next request.

### 2. The route owns the calendar and the meaning; the store owns the tables

`GET /api/v1/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD[&dentistId=…]` resolves the
inclusive clinic-local dates through `resolveClinicDateRange` into a **half-open UTC
window** `[from 00:00, day-after-to 00:00)`. `to` is inclusive because that is how a
person reads a date filter; the half-open window is why a 23:59 appointment is still
inside the period. The route caps a period at **366 days** so a crafted query string
cannot turn a report into a full-table scan.

The definitions live in the route, in one place, and are identical on both engines:

- **Appointments** are bookings that _begin_ in the window; the whole duration counts.
  A period is a week or a month, so clipping at a midnight edge would only lose work
  the period claims to contain.
- **Production** is the net charge value raised in the window
  (`unit price × quantity − discount`), before tax — the same quantity the patient's
  balance already uses, so there is no second formula.
- **Collections** is money received in the window.
- **Outstanding** is the clinic's open invoice value **as of now**, independent of the
  window: a report for last month must not pretend an unpaid invoice stopped existing.
- **Occupancy** is booked minutes over the clinic's recorded capacity for the period:
  each local day's open minutes less its break, times the active clinicians (or one
  when the report is filtered to one). Never `0%` — with no recorded hours the
  denominator is `null` and the UI renders an em dash, exactly as the dashboard does.
- **Dentist performance** is the same appointment and production figures grouped by
  the clinician the row names.

### 3. Attribution is explicit, and unassignable value stays visible

Appointments and production attribute to a clinician because the underlying rows do.
**Payments do not carry a clinician, so collections are a clinic-period figure and are
never split by dentist — even when a dentist filter is active.** A report that invented
an attribution would be worse than one that says "not attributable", so the copy on the
page says so.

A charge filed without a visit has no clinician. It is reported under `dentistId: null`
and labelled **"Unassigned"**, sorted last, rather than dropped or handed to whoever
happened to be in the room.

### 4. Two books, one transaction — extended to money

The outstanding total is two statements, not one join: billed (`sum(invoice.total)`
over non-`VOID` documents) minus allocated (`sum(payment_allocation.amount)` over the
same documents). Joining invoices to allocations before summing would multiply an
invoice's total by the number of payments that touched it. The result is clamped at
zero, matching the patient balance's signed-but-not-negative presentation.

### 5. Export is a browser download, in both shells

`PlatformCapabilities.saveFile` now creates a Blob object URL and clicks a temporary
anchor instead of rejecting on web. CSV export therefore works in the web build and in
the Tauri webview without a new native capability or a Rust change (rule 5: the app
still imports no Tauri API). The desktop shell may later provide a real "save as"
dialog through `mountApp({ capabilities })`; no caller changes. A platform with no DOM
still rejects with `PlatformUnsupportedError` rather than pretending a file was written.

## Consequences

- Reports cannot disagree with the rows they summarise; there is no cache to invalidate.
- A very wide period is a real query cost. The 366-day cap bounds it; if a clinic needs
  multi-year trends, that is a separate decision (a summary table, with its own ADR).
- Collections being clinic-wide is a deliberate limitation that follows from the
  schema. Per-clinician collections would require `payments` to carry a clinician, which
  is a billing-model change, not a reporting one.
- The read store's method shapes leak the grouping (by status, by clinician). That is
  intentional: it keeps the SQL a group-by and the arithmetic in one testable place.
- ADR 0025's "write it twice" rule now covers the reporting read store.

## Alternatives rejected

- **A `reports` table / materialised view refreshed on a schedule.** Fast, but stale and
  a second source of truth for money.
- **Computing figures in the browser from list endpoints.** Makes the frontend the
  authority on production and occupancy, and re-derives across engines.
- **Splitting collections by dentist.** Would invent an attribution the schema does not
  support.
- **A native save dialog now.** Adds a Tauri capability and Rust surface for a feature a
  webview download already satisfies.
- **Exclusive `to` end date.** Reads as "up to but not including", which is not how a
  manager fills in a date filter, and would silently drop the last day.
