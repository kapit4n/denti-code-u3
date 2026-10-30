# ADR 0033 — The payment ledger is a read-only view; recording starts at the visit

- **Status:** Accepted; recording widened by [ADR 0034](./0034-invoice-scoped-payments-come-from-the-patient-ledger.md) and [ADR 0035](./0035-payment-ledger-can-record-against-a-chosen-invoice.md); the ledger itself remains a read model
- **Date:** 2026-10-28
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `apps/api` (payment repository, HTTP route), `packages/domain` (ledger read model), `packages/validation`, `packages/app` payments feature, `packages/ui` (reused `Table`)
- **Relates to:** [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0027](./0027-reports-are-a-read-model-over-settled-rows.md)

## Context

The sidebar's **Payments** link had no screen. Payments were already stored against
visits by the settlement flow: `payVisitCharges` writes the payment, its allocation and
the invoice in one transaction, refuses overpayment, and closes the recording form once
the visit is invoiced. What was missing was a clinic-wide way to see the money that came
in, by period and method.

That left one question before any code: should `/payments` also record money? A
clinic-wide form would have to choose a patient and an open invoice, invent a payment
with no allocation when none exists, and would sit beside the settlement flow that
already owns those rules. Two doors that both take money would eventually disagree about
what a valid payment is.

## Decision

> **Amended by ADR 0034 and ADR 0035.** This ADR still governs `/payments` as a read
> model: the rows, clinic-local window, method filter, paging and server-side total are
> unchanged. Recording did not stay at the visit forever. ADR 0034 added
> `POST /api/v1/invoices/:invoiceId/payments`, which lets the patient's own invoices
> card settle one existing document. ADR 0035 added a **Record payment** action to
> `/payments` itself, but it opens the same invoice-scoped door: the operator chooses a
> patient and one existing open invoice. The ledger still does not invent an unattached
> payment, compute a balance, or write a row itself.

### 1. The ledger is a read model over the payment rows

`PaymentRepository.listForClinic` reads `payments` joined to `patients` for the display
name, filtered by the authenticated clinic, an optional method, and the received-at
window. It is implemented once per engine (ADR 0025), ordered by
`received_at desc, id desc`, and returns the page plus the filtered total. There is no
ledger table, no cached total and no second source of truth; correcting or voiding a
payment changes the next read.

### 2. The route owns the period, the page and the money total

`GET /api/v1/payments?from=YYYY-MM-DD&to=YYYY-MM-DD[&method=…][&page=…][&limit=…]`
resolves the inclusive clinic-local dates through `resolveClinicDateRange` into a
**half-open UTC window** `[from 00:00, day-after-to 00:00)`. `to` is inclusive because
that is how a person reads a date filter.

The route caps a period at **366 days**, pages at **20 by default / 100 maximum**, and
answers `422 VALIDATION_ERROR` for a reversed range, an unknown method, or a period past
the cap. `totalAmountMinor` sums **every row matching the period and method**, not only
the current page, so the ledger's total does not change when the desk pages forward.

The window remains half-open and the page counts stay inside the route, so the SQL is
one shape on both engines and a crafted query string cannot turn the ledger into a
full-table scan.

### 3. Reading money is `billing:read`

The route requires `billing:read`: `ADMINISTRATOR`, `DENTIST` and `RECEPTIONIST` may
read the ledger; `ASSISTANT` may not. Hiding the sidebar link from a role that cannot
read it is convenience only — the API remains the barrier. The ledger is clinic-wide
because payments carry no clinician; it is not a per-dentist collection view (the same
attribution limit ADR 0027 records).

### 4. The UI reads, filters and links; recording names an existing invoice

`/payments` defaults to the clinic's month-to-date, offers an inclusive date range and a
method filter, pages the rows, and links each row to its patient. The total comes from
the server. Since ADR 0035 the header also offers **Record payment**, but it is not a
free-form clinic-wide form: it chooses a patient and one of that patient's open invoices,
then submits through the same invoice-scoped endpoint as the patient card (ADR 0034).
Money is still recorded where the invoice and allocation are in hand — the visit
workspace, the patient's invoices card, or this ledger door. The ledger itself only reads
money; it never invents an unattached payment or recomputes a balance.

## Consequences

- The ledger cannot disagree with the payments the clinic recorded.
- The page is still a window on settled rows, not a free-form cash-register screen.
  Receipt printing, editing, deleting and recording unattached money are still absent.
- Collections by clinician remain impossible from this schema; the clinic-wide total is
  the honest figure.
- A wide period costs a real query, bounded by the 366-day cap.
- Recording money with no visit or no invoice is still an explicit product gap (open
  question 22), not an accidental omission. Invoice-scoped payments are ADR 0034; the
  ledger's invoice-choosing door is ADR 0035.

## Alternatives rejected

- **A free-form recording form on `/payments`.** It would duplicate the settlement rules
  or create money with no invoice and no allocation. ADR 0034 later added a narrower form
  on the patient's invoices card, where the invoice is already selected; ADR 0035 added
  the same invoice-choosing action to the ledger itself.
- **A per-dentist ledger.** Payments carry no clinician; inventing an attribution would
  make the total wrong in a way the screen cannot explain.
- **A summary table or nightly total.** Fast, but stale, and a second source of truth for
  money (the reason ADR 0027 rejected one for reports).
- **Computing the total in the browser from the current page.** It would silently change
  the clinic's collections when the user paged.
