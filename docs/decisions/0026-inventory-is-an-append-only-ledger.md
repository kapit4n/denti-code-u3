# ADR 0026 — Inventory is an append-only ledger with a cached level

- **Status:** Accepted
- **Date:** 2026-10-22
- **Deciders:** Principal Architect, Product Owner
- **Affects:** `packages/domain` inventory, `packages/validation`, `apps/api` persistence and routes, `packages/app` inventory page, `database/schema` (both engines)
- **Relates to:** [ADR 0014](./0014-clinic-scoping-repository-pattern.md), [ADR 0025](./0025-two-engines-sqlite-runs-postgresql-kept.md)

## Context

Milestone 10 needs three things: items with units, stock levels and minimums; stock
movements when consumables are used; and visibility of what is low. The database
already had `inventory_items` and `stock_movements`, but nothing read or wrote them,
and the domain had only a placeholder.

The question is what the source of truth is. A single mutable `stock` column is the
smallest possible feature, but it cannot answer "what happened?", and a correction
would overwrite the evidence. A ledger alone is auditable but makes every list read
sum the whole history, which is a poor trade for a page that draws on every visit.
Keeping two books without a rule is how they drift.

## Decision

### 1. Two books, one transaction

`inventory_items.stock` is a **cached projection** of the item's movements. It exists
so the catalogue and the low-stock card are one cheap read. Every change writes the
append-only `stock_movements` row and updates `inventory_items.stock` **in the same
transaction**. A movement without the new level, or a level without the movement, is
the one failure this design exists to prevent.

### 2. Quantity is positive; the type names the direction

A movement's `quantity` is always a positive integer. `USAGE` and `EXPIRED` take
stock out; `PURCHASE`, `RETURN` and `ADJUSTMENT` put it in. A signed quantity would
make "how much moved" and "which way" one field, and every reader would have to
remember the sign. A downward correction is therefore an `EXPIRED` or a usage
correction, never a negative adjustment.

An outflow larger than the stock on hand is **refused** (`INSUFFICIENT_STOCK`), not
clamped. A clamped level hides a discrepancy; a refusal tells the desk it used
something it does not have. The API folds that refusal into the same 409 envelope as
other domain rules.

### 3. Opening stock is a movement

Creating an item with stock already on the shelf writes an `ADJUSTMENT` movement
referenced as `Opening stock`, in the item's creation transaction. Zero opening stock
writes no movement: zero is the absence of stock, not an event. The level and the
ledger therefore agree from the first read.

### 4. Low stock is a comparison, not a server filter

`isLowStock(item)` is `stock <= minStock`. `GET /api/v1/inventory/items` returns every
item in name order, including the two columns, and the page filters with the domain
function. A `?lowStock=true` endpoint would be a second answer that could disagree
with the row drawn beside it.

### 5. Scoping follows the row that carries the tenant

`inventory_items` carries `clinic_id`, so its reads and writes are scoped directly.
`stock_movements` has no clinic column, so `listMovements` joins the item and filters
the clinic, and both movement routes resolve the item in the request's clinic first.
Another clinic's item is the same `NOT_FOUND` as one that never existed — never an
empty history.

### 6. One port, two engines

`InventoryRepository` (`listByClinic`, `findById`, `add`, `updateStock`,
`addMovement`, `listMovements`) is implemented once per engine (ADR 0025).
`addInventoryItem` and `recordStockMovement` receive a `UnitOfWork` because each
writes two rows atomically. A duplicate SKU is refused by the `(clinic_id, sku)`
unique index and translated to `DUPLICATED_RECORD` on both engines, not pre-checked
in the use case.

## Consequences

- The page can draw levels without summing history, and the history remains the
  audit record.
- Any future correction must be a movement. Editing `stock` directly is now a bug,
  and the repository exposes no verb for it.
- Batches, lot numbers, expiry-driven depletion and transfers between locations are
  **not** modelled. When they are, they need their own ADR; adding a sixth movement
  type with an overloaded meaning is not the answer.
- The cached column is a deliberate denormalisation. If a future write path bypasses
  the use cases, the two books can drift; keeping every stock write inside the port
  and its transaction is the invariant to protect.
- Costs are integer minor units, like every other money field. The form accepts major
  units and converts once at the boundary.

## Alternatives rejected

- **Mutable stock only.** Simplest, but loses the audit trail and makes low-stock and
  usage history impossible to explain.
- **Ledger only, stock derived on every read.** Truthful but repeatedly sums the
  whole history for a page that only needs the current number.
- **Signed movement quantities.** Collapses direction into the number and invites
  double-negation bugs at every boundary.
- **A `GET …?lowStock=true` endpoint.** Creates a second definition of "low" that can
  disagree with the rows on the same screen.
