# Denti-Code U3 — Domain Model

Status: **Phase 1 vocabulary** · This document defines _what the clinic domain
is about_ and where its boundaries are. It deliberately contains no SQL, no
React, and no framework references. The executable version of this vocabulary is
`packages/domain` (entities, value objects, ports) and `database/schema`
(persistence).

---

## 1. Bounded contexts

The dental clinic domain is modelled as five contexts with an explicit
dependency order. Higher contexts may use lower ones; never the reverse.

```
┌─────────────────────────────────────────────────────────────────┐
│ 5. COMMERCIAL     billing, invoices, payments, inventory, reports │
│      (reads clinical charges, never writes clinical state)        │
├─────────────────────────────────────────────────────────────────┤
│ 4. CLINICAL       visits, clinical notes, odontogram,             │
│                    treatments, treatment plans, prescriptions     │
├─────────────────────────────────────────────────────────────────┤
│ 3. CARE DELIVERY  appointments, agenda, chairs/rooms assignment  │
├─────────────────────────────────────────────────────────────────┤
│ 2. PATIENT        patient identity, clinical summary, allergies  │
├─────────────────────────────────────────────────────────────────┤
│ 1. ORGANIZATION   clinic, users, dentists, staff, roles, rooms,  │
│                    chairs, catalog                               │
└─────────────────────────────────────────────────────────────────┘
```

| Context       | Owns                                                                                                        | Notes                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Organization  | `Clinic`, `User`, `Dentist`, `Staff`, `Role`, `Room`, `Chair`, service catalog                              | Identity and physical resources            |
| Patient       | `Patient`, allergies, medical history, consents, balance summary                                            | The primary clinical subject               |
| Care delivery | `Appointment` (+ its lifecycle)                                                                             | Scheduling is not billing and not clinical |
| Clinical      | `Visit`, `ClinicalNote`, `OdontogramEntry`, `Treatment`, `TreatmentPlan`, `Prescription`, clinical `Charge` | What happened to the patient               |
| Commercial    | `Invoice`, `Payment`, `PaymentAllocation`, `InventoryItem`, stock movements                                 | Money and stock                            |

The "charge vs invoice vs payment" split is the classic dental/EHR ambiguity and
is decided explicitly here:

- `Charge` = a priceable clinical event recorded during a visit (produced by
  **Clinical**).
- `Invoice` = a document grouping charges and adjustments that is issued to a
  patient (owned by **Commercial**).
- `Payment` = money received, allocated to one or more invoices.

A charge may exist before any invoice exists (common in real clinics: work is
done, billing happens later). The domain therefore models
`charge → optional invoice` as a _nullable_ link, not a mandatory one.

## 2. Entities

### 2.1 Clinic — tenant root

Every record belongs to a clinic from day one. Today the product operates a
single clinic, but the column exists on every table, so multi-clinic support is
a policy/filtering change rather than a schema rewrite.

```
Clinic { id, name, legalName?, timezone, currency, settings, createdAt, updatedAt }
```

### 2.2 User, Dentist, Staff — people who work in the clinic

```
User      { id, clinicId, email, passwordHash?, fullName, status, lastSeenAt? }
Role      — Administrator | Dentist | Assistant | Receptionist
Staff     { id, clinicId, userId, role, licenseNumber?, isActive }
Dentist   { id, clinicId, userId, specialties[], defaultChairId? }
```

`User` is the identity (login, audit). `Staff` and `Dentist` are clinic-scoped
roles of that identity. A dentist is staff. Authorization always resolves
`user → staff → role → clinic`, never a role string stored on a UI component.

### 2.3 Patient — the primary clinical subject

```
Patient {
  id, clinicId,
  firstName, lastName,
  preferredName?,
  identificationNumber?,     // DNI / SSN / national id
  phone?, email?,
  birthDate?, gender?,
  isActive, deletedAt?,
  createdAt, updatedAt
}
```

Derived (computed, never stored redundantly in two places): `fullName`,
`birthDate`-derived age, `openBalance`.

Clinical context hanging off the patient: allergies, medical conditions,
medications, consents, clinical summary, upcoming appointment, recent visits,
current treatments, financial balance — see `docs/frontend.md` § patient profile.

### 2.4 Room and Chair — the physical resources of the clinic

```
Room   { id, clinicId, name, floor?, isActive }
Chair  { id, clinicId, roomId?, name, kind, isActive }
```

Chairs are the unit that actually gets occupied in the agenda; a room is a
grouping of chairs. Both are filterable in the agenda.

### 2.5 Appointment — scheduling (Care delivery)

```
Appointment {
  id, clinicId,
  patientId,
  dentistId,
  roomId?, chairId?,
  startsAt,           // timestamptz, clinic-local intent stored as UTC
  durationMinutes,
  status,             // see lifecycle below
  treatmentId?,       // planned treatment (may be undefined)
  visitId?,           // set when the appointment materialises as a Visit
  notes?,
  cancelledReason?,
  createdAt, updatedAt
}
```

Rules that live in `packages/domain` (not in the UI):

- `durationMinutes > 0` and must fit inside the clinic's operating hours for
  that day.
- `endsAt = startsAt + durationMinutes` is computed, never stored.
- Chair conflicts are detected at scheduling time
  (`findSchedulingConflicts`), never in the calendar component.
- `status` transitions are the only legal way to change the state.

### 2.6 Visit — the clinical interaction (Clinical)

```
Visit {
  id, clinicId,
  patientId,
  dentistId,
  appointmentId?,
  chairId?,
  startedAt?, endedAt?,
  status,                 // Open | Completed | Cancelled
  summary?,
  createdAt, updatedAt
}

Visit → ClinicalNote[]         (typed notes: anamnesis, evolution, …)
Visit → OdontogramEntry[]      (per-tooth state)
Visit → TreatmentRecord[]      (what was actually done)
Visit → Prescription[]
Visit → Charge[]
Visit → PaymentAllocation[]    (payments linked through the invoice)
Visit → VisitAttachment[]      (files: radiographs, photos; reference — name, type, size, clock)
```

Rules:

- A visit belongs to exactly one patient and one dentist. A patient is the
  subject; the dentist is the author.
- `Visit` may exist without an `Appointment` (walk-in patients) but an
  appointment becomes a visit exactly once (`startVisitFromAppointment`).
- A visit with `status = Completed` may no longer accept new clinical records;
  it may only be re-opened by a dentist, and that re-opening is auditable.

### 2.7 Odontogram — per-tooth state, permanent and primary

```
OdontogramEntry {
  id, clinicId, patientId, visitId?,
  dentition: Permanent | Primary | Mixed,
  tooth: FDI notation ("16", "51", …),
  surfaces: Mesial, Distal, Buccal, Lingual, Occlusal, Incisal,
  condition,           // Healthy, Caries, Filled, Missing, Crown, Implant,
                       // RootCanal, ExtractionIndicated, Extracted, Sealant,
                       // Veneer, Fracture, Mobility
  notes?
}
```

`dentition + tooth` is the natural key of an odontogram entry (one active entry
per tooth per patient). FDI notation is chosen over the universal system because
it is unambiguous across countries and directly expresses quadrants; the
mapping table lives in `packages/domain/src/odontogram/`.

### 2.8 Treatment, TreatmentPlan, Prescription

```
Treatment        { id, clinicId, code, name, category, defaultDurationMinutes, defaultPrice }
TreatmentPlan    { id, clinicId, patientId, dentistId, title, status, startedAt? }
TreatmentPlanItem{ id, planId, treatmentId, toothRef?, sequence, status, estimatedPrice? }
TreatmentRecord  { id, clinicId, visitId, patientId, treatmentId, toothRef?, status,
                   performedAt, notes? }
Prescription     { id, visitId, patientId, dentistId?, issuedAt,
                   medication, dosage, route, frequency, durationDays, instructions? }
```

A `TreatmentPlan` is a _proposal_ ordered by `sequence`; a `TreatmentRecord` is
a _fact_ ("this was performed, in this visit"). Progress ("pending treatments"
on the dashboard) is derived from the difference between the two — it is a
projection, not a stored counter.

A `Prescription` (session 31) carries **no clinic of its own**: tenancy comes
through its visit (a prescription this clinic does not hold is a 404, answered by
reading the visit first). `patientId` is the visit's patient and `dentistId` the
visit's dentist — inherited, never accepted from the body, and nullable
(`on delete set null`, like `Visit.dentistId`). `route` is the `MEDICATION_ROUTES`
enum (Oral, Topical, Inhaled, Injection, Rectal, Other), `durationDays` is whole
days 1–365 with a `CHECK` on the column, and `issuedAt` is the clinic's clock.

A `Charge` (session 32) is the **first billing row with a clinic of its own**, and
the first of the five per-visit books to carry `clinic_id`: `clinical_notes`,
`visit_treatment_executions` and `prescriptions` take their tenancy from the visit,
while a charge is priced against the clinic itself, so `findForVisit(clinicId,
visitId)` filters on the charge's own column (defence in depth on a read) and both
verbs still read the visit first — a foreign visit is a 404 before any row moves.
`patientId` and `visitId` are inherited from the visit, `currency` comes from the
clinic (a request must never name the currency its own charge is priced in),
`createdAt` is the clinic's clock, and `taxRatePercent` lands as `0` — the tax field
is deliberately not in the body yet (open question, `docs/open-questions.md`).
Money on the row is integer minor units throughout: the line total is
`calculateChargeTotal` (quantity × unit price − discount + tax), never recomputed a
second way. `invoicedAt`/`invoiceId` are what Milestone 9 will fill; until then a
charge exists before any invoice, exactly as the split in section 1 intends.

`payVisitCharges` (session 32, `domain/billing/visit-payments.ts`) is the first
billing **write**: it records a payment against a visit's bill and, in the same
transaction, folds **every un-invoiced charge into one invoice** whose status comes
from `deriveInvoiceStatus` over `ISSUED` — `PAID` when the payment covered the bill,
`PARTIALLY_PAID` otherwise. Money that exceeds the outstanding bill is refused in the
domain (a negative receipt is a validation error, never a credit), a blank or
over-long `reference` is refused, and a visit whose charges are already invoiced has
nothing left to pay — the settlement made the receipt, so a second payment is refused
until Milestone 9's invoice ledger generalises the case. `listVisitPayments` joins
payments → allocations → invoices → charges, newest first, and a payment's `method`
is the `PAYMENT_METHODS` enum (`CASH`, `CARD`, `TRANSFER`, `YAPE`, `PLIN`, `OTHER`).

### 2.9 Payment, Invoice, Inventory

```
Invoice        { id, clinicId, patientId, visitId?, number, status, issuedAt, dueAt?, subtotal, discount, tax, total, paid }
Charge         { id, clinicId, visitId?, patientId, treatmentId?, description,
                 quantity, unitPriceMinor, discountMinor, taxRatePercent, currency,
                 invoiceId?, invoicedAt?, createdAt }
Payment        { id, clinicId, patientId, method, amount, receivedAt, reference? }
PaymentAllocation { paymentId, invoiceId, amount }
InventoryItem  { id, clinicId, name, sku?, unit, stock, minStock, cost, isActive }
StockMovement  { id, clinicId, itemId, type, quantity, reason, occurredAt, visitId? }
```

Money rules live in the domain: amounts are integers in the **minor unit**
(cents) — never floats. `Invoice.total = subtotal - discount + tax` is enforced
by `calculateInvoiceTotals`. `Patient` balance is
`sum(unpaid invoice totals) - sum(unallocated payments)`.

## 3. Appointment lifecycle

Statuses are domain data (`packages/domain/src/appointment/appointment-status.ts`).
The UI derives color and label from these semantic values; color is never the
source of truth.

```
                  ┌──────────────┐
   schedule ─────>│  Scheduled   │
                  └──────┬───────┘
              confirm   │   arrive
        ┌──────────────┐ └──────────┐
        v              │            v
 ┌────────────┐        │     ┌────────────┐
 │  Confirmed │────────┘     │  Arrived   │
 └─────┬──────┘              └─────┬──────┘
       │ start                     │ begin chair time
       v                           v
 ┌─────────────────────┐     ┌───────────────┐
 │    In Treatment     │     │ In Treatment  │
 └──────────┬──────────┘     └───────┬───────┘
            │ finish                │ finish
            v                       v
      ┌───────────┐            ┌───────────┐
      │ Completed │            │ Completed │
      └───────────┘            └───────────┘

  From Scheduled / Confirmed / Arrived / In Treatment:
      ├──────────────> Cancelled  (with cancelledReason)
      └──────────────> No-show    (patient did not arrive)
```

Legal transitions, enforced by `canTransitionAppointment`:

| From         | Allowed next                                        |
| ------------ | --------------------------------------------------- |
| Scheduled    | Confirmed, Arrived, Cancelled, No-show              |
| Confirmed    | Arrived, Cancelled, No-show, Scheduled (un-confirm) |
| Arrived      | In Treatment, Cancelled, No-show                    |
| In Treatment | Completed, Cancelled                                |
| Completed    | _(terminal)_                                        |
| Cancelled    | Scheduled (re-book)                                 |
| No-show      | Scheduled (re-book)                                 |

Terminal states are `Completed`, `Cancelled`, `No-show`; `Completed` is fully
terminal. Only `Scheduled`/`Confirmed` may be edited in time/dentist/chair;
after `Arrived` the time is historical.

## 4. Visit lifecycle

```
Patient ──(optional Appointment)──> Visit
                                     │
             status: Open ───────────┼──────────> Completed
                                     │
                                     └──> Cancelled
```

Rules:

1. `startVisitFromAppointment(appointment, dentist)` — creates the Visit and
   links `appointment.visitId`, flipping the appointment to `In Treatment`.
   This is the single legal bridge between scheduling and clinical.
2. While a visit is `Open`, clinical notes, odontogram entries, treatments,
   prescriptions, charges and attachments can be added.
3. `completeVisit(visit)` requires at least the visit to be started; it closes
   the record. Post-completion changes require `reopenVisit`, which is audited.
4. A completed visit is the unit that billing draws charges from.

## 5. Cross-cutting domain rules (where they live)

| Rule                                                | Module                | Enforced by                                         |
| --------------------------------------------------- | --------------------- | --------------------------------------------------- |
| Appointment status transitions                      | `domain/appointment`  | `canTransitionAppointment` + unit tests             |
| Appointment end time                                | `domain/appointment`  | `computeAppointmentEnd`                             |
| Scheduling conflicts (chair/dentist overlap)        | `domain/appointment`  | `findSchedulingConflicts`                           |
| Visit ↔ appointment bridge                          | `domain/visit`        | `startVisitFromAppointment`                         |
| Visit state machine                                 | `domain/visit`        | `canTransitionVisit`, `reopenVisit`                 |
| FDI tooth notation + dentition validation           | `domain/odontogram`   | `toothNumberSchema`, tooth catalogs                 |
| Odontogram condition set                            | `domain/odontogram`   | `ODONTOGRAM_CONDITIONS`                             |
| Treatment plan progress                             | `domain/treatment`    | `calculateTreatmentPlanProgress`                    |
| Invoice totals, balances, money as integers         | `domain/billing`      | `calculateInvoiceTotals`, `calculatePatientBalance` |
| Roles and permissions                               | `domain/organization` | `ROLE_PERMISSIONS`, `hasPermission`                 |
| Clinic timezone interpretation of a local date/time | `domain/organization` | `clinicDayBounds`                                   |

Anything that needs I/O to evaluate is _not_ a domain rule; it is a port
(`AppointmentRepository.findOverlapping`) invoked by an application use case.
The pure overlap check then consumes the rows the repository returned.

## 6. Domain ports (interfaces owned by the domain)

`packages/domain/src/ports/` declares what the outside world must provide:

```ts
(PatientRepository,
  AppointmentRepository,
  VisitRepository,
  TreatmentRepository,
  TreatmentPlanRepository,
  OdontogramRepository,
  PrescriptionRepository,
  PaymentRepository,
  InvoiceRepository,
  ClinicRepository,
  DentistRepository,
  RoomRepository,
  ChairRepository,
  InventoryRepository,
  UnitOfWork,
  Clock,
  IdGenerator,
  Logger);
```

The API implements them with Drizzle. The domain never sees Drizzle types
([ADR 0004](./decisions/0004-framework-independent-domain.md)).

`Clock` and `IdGenerator` are ports rather than `Date.now()`/`crypto` calls so
that time-dependent rules (appointment conflicts, ageing) are deterministically
testable. This is not speculative abstraction — it is required by the tests we
already have.

## 7. Vocabulary → code map

| Concept            | Domain module                   | Table                                | API resource             |
| ------------------ | ------------------------------- | ------------------------------------ | ------------------------ |
| Clinic             | `domain/organization/clinic`    | `clinics`                            | `/clinics`               |
| User/Staff/Dentist | `domain/organization/identity`  | `users`, `staff`, `dentists`         | `/dentists`              |
| Patient            | `domain/patient`                | `patients`                           | `/patients`              |
| Appointment        | `domain/appointment`            | `appointments`                       | `/appointments`          |
| Visit              | `domain/visit`                  | `visits`                             | `/visits`                |
| Treatment/Plan     | `domain/treatment`              | `treatments`, `treatment_plans`, …   | `/treatments`            |
| Odontogram         | `domain/odontogram`             | `odontogram_entries`                 | `/odontograms`           |
| Prescription       | `domain/prescription`           | `prescriptions`                      | `/prescriptions`         |
| Billing            | `domain/billing`                | `invoices`, `charges`, `payments`    | `/invoices`, `/payments` |
| Physical resources | `domain/organization/resources` | `rooms`, `chairs`                    | `/rooms`, `/chairs`      |
| Inventory          | `domain/inventory`              | `inventory_items`, `stock_movements` | `/inventory`             |

## 8. Open questions (domain)

These need product input and are tracked in [`open-questions.md`](./open-questions.md):

1. **Multi-clinic vs single-clinic** — is `Clinic` a real multi-tenant
   dimension, or a configuration row for one clinic? Affects the auth model.
2. **Tooth notation standard** — FDI assumed. Confirm (Palmer / universal may
   be required for some markets).
3. **Treatment price catalogue** — are prices per clinic, per dentist, or from a
   global catalogue with overrides?
4. **Fiscal requirements** — country-specific invoice numbering, tax handling,
   and required fields are unknown. Money is stored as integers + ISO currency,
   which keeps the door open, but numbering rules need product/legal input.
5. **No-show / late-arrival accounting** — should late arrivals be tracked
   separately for clinic analytics (they affect "occupancy rate")?
6. **Record retention / anonymisation** — clinical data retention policy is not
   defined; no compliance regime is claimed.
