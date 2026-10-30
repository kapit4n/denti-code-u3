# ADR 0034 — A payment can be recorded against one invoice from the patient ledger

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `packages/domain` (invoice payment use case), `apps/api` (invoice route, use case wiring), `packages/app` (patient invoices section), `packages/validation` (reused payment schema)
- **Relates to:** [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md), [ADR 0027](./0027-reports-are-a-read-model-over-settled-rows.md), [ADR 0033](./0033-payment-ledger-is-read-only.md)

## Context

ADR 0033 kept recording at the visit settlement flow and left `/payments` read only.
That was right for a clinic-wide ledger, which has no patient or invoice in hand. It left
a real gap on the patient record: the invoices card already lists every issued document
and its outstanding balance, but collecting a follow-up payment still required finding
the visit that raised the invoice. A patient returning to pay an old balance is not
necessarily visiting the clinic again.

The patient ledger knows the two things a payment needs: the patient and a specific
invoice. It does not need the visit id, and asking the front desk to trace one would make
the screen less useful than the data it already shows.

## Decision

### 1. The door is invoice-scoped

`POST /api/v1/invoices/:invoiceId/payments` records a payment against one existing
invoice, with `billing:write`. The path names the invoice rather than the patient because
the invoice is what the money allocates to; its patient and currency are read from the
document, not restated by the caller. `/payments` remains read only.

### 2. `payInvoice` writes the payment, allocation and status in one transaction

`payInvoice` runs inside `UnitOfWork`. It loads the invoice scoped to the request's
clinic, then refuses:

- an invoice this clinic does not hold (`NOT_FOUND`, indistinguishable from one that
  belongs elsewhere);
- a `DRAFT` or `VOID` document;
- a document with nothing left to pay;
- a zero, negative or non-integer amount;
- an amount greater than the document's balance;
- a reference longer than 200 characters after trimming.

It saves the payment and a payment allocation for the **whole** amount against that
invoice, then derives the new status from the document's stored total and allocated
total (`ISSUED` → `PARTIALLY_PAID` → `PAID`) and updates it only when it changed. The
payment inherits the invoice's patient and currency, and takes its id and received-at
from the injected generators. A reference that is only whitespace is stored as `null`.

### 3. One invoice, one allocation, no unattached money

The payment is fully allocated to the invoice named in the path. This slice deliberately
does not split money across invoices, allocate oldest-first outside the visit flow, or
store a deposit with no document. Those rules need a separate product decision; this
door only settles money the clinic has already billed.

### 4. The UI offers the action where the balance is shown

The patient's invoices card shows **Record payment** only on a row with
`balanceMinor > 0`. The dialog reuses the existing payment method vocabulary and minor
unit parsing, submits through the typed client, and keeps the draft and quotes the
server on refusal. A successful payment invalidates the patient's profile, invoices,
balance and statement, plus the clinic-wide `/payments` and visit payment registers, so
every screen redraws from a fresh read rather than updating itself optimistically.

The path id is shape-checked before the use case runs: a non-UUID segment is a
`422 VALIDATION_ERROR`, not a database error.

## Consequences

- The front desk can collect an old invoice balance without opening its visit.
- The visit settlement flow is unchanged. Both doors share the payment and allocation
  repositories and the same status derivation, but the visit door still owns folding
  un-invoiced charges into a document and allocating across the visit's open documents.
- Editing or deleting a payment, receipts, cross-invoice allocation, patient deposits
  and unattached credit remain absent. `/payments` still cannot record money.
- Payments still carry no clinician, so collections remain clinic-wide (ADR 0027).
- Repeating the same request is not idempotent; it is a second payment. The amount
  ceiling and the balance check make that visible rather than silently folding it into
  the first.

## Alternatives rejected

- **A recording form on `/payments`.** It would need a patient and invoice choice before
  it could allocate anything, duplicating the ledger screen and inviting unattached
  money (the reason ADR 0033 rejected it).
- **Keep requiring the visit id.** Correct but obstructive: the invoice already knows its
  patient, and the patient screen already knows its invoices.
- **Let the client send the patient and currency.** They are facts of the document; a
  request that can restate them can restate them wrongly.
- **Update the invoice in the browser from the submitted amount.** The server derives
  the status from stored totals; the next read is the only reliable source.
