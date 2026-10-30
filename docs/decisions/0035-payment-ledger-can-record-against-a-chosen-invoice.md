# ADR 0035 — The payment ledger can record against a chosen invoice

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `packages/app` (payments page, record-payment dialog), `e2e`
- **Relates to:** [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0033](./0033-payment-ledger-is-read-only.md), [ADR 0034](./0034-invoice-scoped-payments-come-from-the-patient-ledger.md)

## Context

ADR 0033 made `/payments` a read-only clinic-wide view. ADR 0034 added recording
against one invoice from the patient's own invoices card. That left a front-desk
chore: taking a payment starts at the patient record, even when reception is already
looking at the payment ledger and knows the patient and the invoice number.

The invoice-scoped write already owns every rule that matters: it loads the document
inside the clinic, refuses draft, void, settled or overpaid documents, writes the
payment and its full allocation in one transaction, and advances the status from the
stored totals. The missing piece was a second entry point, not a second payment rule.

## Decision

### 1. `/payments` gains one recording action

The ledger header offers **Record payment**. It opens a dialog where the operator
chooses a patient, then one of that patient's open invoices. The invoice list excludes
`DRAFT` and `VOID` documents and documents with no balance. The amount defaults to the
invoice's outstanding balance; method and reference are entered as in the existing
invoice dialog.

The action submits through the existing
`POST /api/v1/invoices/:invoiceId/payments`. There is no new API route, domain rule or
database change. `/payments` itself remains a read model: it does not write money and
does not compute the invoice's balance.

### 2. The invoice still has to exist and still has to be open

Recording from the ledger is not a door for unattached money. The patient choice only
narrows the invoice list; the write still allocates the whole payment to the named
invoice. The server remains the authority on whether the document is collectible and
whether the amount is lawful. A document that was settled in another tab between the
read and the submit is refused by the same domain check the patient card already uses.

### 3. The dialog is an entry point, not a second ledger

The patient picker is the shared `PatientPicker`. The invoice list is
`usePatientInvoices`, the same patient-scoped read the invoices card uses. The payment
mutation is `usePayInvoice`, so success invalidates the patient profile, invoices,
balance, statement, the clinic-wide ledger and the visit payment registers together.
No payment is drawn optimistically; every screen redraws from its own read.

### 4. Unattached money remains out of scope

The dialog always pays an existing invoice. Deposits, prepayments, a walk-in with no
document, cross-invoice allocation and payment editing still need their own billing
decision, as open question 22 records.

## Consequences

- Reception can record a payment without first finding the visit or the patient record,
  while the invoice and its allocation remain the unit of truth.
- The write rules live in exactly one place. The new screen cannot disagree with the
  patient invoices card about what a valid payment is.
- ADR 0033's reason for excluding a form is superseded: the form does not invent a
  payment, it selects the invoice an existing use case already requires.
- ADR 0034's "record from the patient ledger only" boundary is widened. Its refusal of
  `DRAFT`/`VOID` documents, overpayment and unattached money still governs the write.
- The ledger page now has a write action but still has no ledger table, cached total or
  client-side arithmetic.
- A patient with no open invoice is told so; the dialog does not offer a free amount
  with nowhere to put it.

## Alternatives rejected

- **A `POST /api/v1/payments` endpoint.** It would need to accept a patient, an invoice
  or no invoice at all, duplicating the allocation rules or creating unattached money.
- **Record from the ledger by naming only a patient.** It cannot know which document
  the money settles, and allocating oldest-first outside the visit flow is a different
  product rule.
- **Move recording out of the patient invoices card.** That card still has the invoice
  in front of it; removing the action would make a known balance harder to collect.
- **Keep `/payments` read-only and send the operator to the patient record.** Correct
  but obstructive, and it was the friction this decision removes.
