/**
 * Domain ports — the interfaces the outside world must satisfy.
 *
 * The domain declares these; infrastructure implements them. That inversion is
 * what keeps `packages/domain` free of Drizzle, PostgreSQL, HTTP and React: the
 * domain says what it needs, never how it is stored or transported.
 *
 * Every port is asynchronous because every implementation is I/O-bound, but the
 * domain's own rules are synchronous and pure.
 */

import type {
  AppointmentId,
  ChargeId,
  ChairId,
  ClinicId,
  DentistId,
  InvoiceId,
  IsoDateTime,
  PatientId,
  TreatmentId,
  VisitId,
} from '@denti-code-u3/types';
import type {
  AgendaEntry,
  AgendaWindow,
  Appointment,
  AppointmentStatus,
  AppointmentWindow,
} from '../appointment/index.js';
import type { Visit, VisitStatus, ClinicalNote, VisitAttachment } from '../visit/index.js';
import type { TreatmentRecord } from '../treatment/index.js';
import type {
  EditablePatientDetails,
  Patient,
  PatientListEntry,
  PatientOdontogram,
  PatientProfile,
} from '../patient/index.js';
import type { Clinic, ClinicRole } from '../organization/index.js';
import type { Charge, Invoice, Payment, PaymentAllocation } from '../billing/index.js';
import type { Prescription } from '../prescription/index.js';

/**
 * Transaction boundary. A use case that must write several rows atomically
 * receives a `UnitOfWork` instead of calling repositories directly.
 */
export interface UnitOfWork {
  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}

/**
 * What one transaction is handed, as the first user of it arrived.
 *
 * **Narrower than Milestone 1 declared it, on purpose.** This listed nine
 * repositories, three of which (`treatments`, `prescriptions`, `payments`) have no
 * implementation because the features they serve are unbuilt. A set that cannot be
 * constructed is not a safety net, so the three were removed and the set grows when
 * the implementations do. This is the third such deletion in this repository — the
 * appointment port's five unsatisfiable methods in session 13, the hidden `ends_at`
 * column in session 3 — and the pattern is consistent (ADR 0021).
 *
 * The alternative was to keep the declared nine and have the API's implementation
 * throw "not implemented yet" for three of them, which is a promise the code has
 * stopped keeping.
 *
 * Session 29 added `clinicalNotes`, the first addition in the other direction: the
 * port arrived with an implementation for both engines (ADR 0025), which is the same
 * policy read forwards — the set holds what can be built, no more and no less.
 *
 * Session 30 adds `treatments` and `treatmentRecords` for the same reason: recording
 * a treatment on a visit needs the clinic's catalogue read and the record written,
 * and both implementations exist before either name enters this set. The set is nine
 * then, and every one of its nine is constructible in both engines.
 *
 * Session 31 adds `prescriptions` in the same direction: prescribing needs the visit
 * read (which `visits` already holds) and the prescription written, and the
 * implementation exists in both engines before the name enters this set. The set is
 * ten now, and every one of its ten is constructible in both engines.
 *
 * Session 32 adds `charges`, the first billing row in the set. Raising a charge needs
 * the visit read and the clinic read (for the currency) and the charge written — and,
 * unlike its clinical siblings, `charges` has its own `clinic_id`, so `findForVisit`
 * scopes in the table itself rather than through a join. The implementation exists in
 * both engines before the name enters this set, and the set is eleven now, every one
 * of its eleven constructible in both engines.
 *
 * Session 33 adds `invoices`, `payments` and `paymentAllocations` together, because
 * the settlement use case writes them *together* — a unit of work that could not
 * build them would be a unit of work that could not do its one job (ADR 0021). All
 * three implementations exist in both engines before their names enter this set, and
 * the set is fifteen now, every one of its fifteen constructible in both engines.
 */
export interface Repositories {
  readonly patients: PatientRepository;
  readonly appointments: AppointmentRepository & AppointmentWriteRepository;
  readonly visits: VisitRepository;
  readonly clinicalNotes: ClinicalNoteRepository;
  readonly prescriptions: PrescriptionRepository;
  readonly charges: ChargeRepository;
  readonly treatments: TreatmentRepository;
  readonly treatmentRecords: TreatmentRecordRepository;
  readonly clinics: ClinicRepository;
  readonly dentists: DentistRepository;
  readonly chairs: ChairRepository;
  readonly invoices: InvoiceRepository;
  readonly payments: PaymentRepository;
  readonly paymentAllocations: PaymentAllocationRepository;
  readonly attachments: VisitAttachmentRepository;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface PageRequest {
  readonly offset: number;
  readonly limit: number;
}

/**
 * What the list endpoint is being asked for.
 *
 * `term` is matched against the names and the chart number — what a receptionist
 * has in front of them, whether they think of the patient by name or by the number
 * on the paperwork. `onlyActive` exists because a deactivated record stays
 * searchable: hiding it entirely would make it impossible to find and reactivate,
 * which is the opposite of what deactivating is for.
 */
export interface PatientSearchQuery {
  readonly term?: string;
  readonly onlyActive?: boolean;
  readonly page: PageRequest;
}

/**
 * Patient writes: registration and editing.
 *
 * Narrower than `PatientRepository`, and split out because both methods have an
 * atomicity requirement that a caller driving separate calls cannot express.
 * Reading the highest issued record number and inserting a patient with it are one
 * critical section; checking that a patient belongs to the clinic and writing to
 * it are one statement.
 *
 * This was once named `PatientRegistrationRepository`, with a comment explaining
 * that the read methods were deliberately absent because nothing called them.
 * Nothing called them because nothing implemented them, which is the same problem
 * wearing a justification: the read routes went on querying Drizzle themselves.
 * The reads now live here too.
 */
export interface PatientWriteRepository {
  /**
   * Stores a new patient and assigns its clinic-scoped record number.
   *
   * Returns the record number actually written. Implementations must be safe to
   * call concurrently: two receptionists registering at the same moment must not
   * produce the same number, because the unique index would then reject one of
   * them in front of a patient who is already at the desk.
   */
  register(patient: Patient): Promise<{ readonly recordNumber: string }>;

  /**
   * Overwrite the editable fields of a patient in one clinic.
   *
   * `clinicId` is part of the write, not a precondition checked by the caller, so
   * that an edit cannot reach across clinics (ADR 0014). Returns false when the
   * clinic holds no such patient — including when it belongs to another clinic,
   * which must be indistinguishable from not existing.
   */
  update(
    clinicId: ClinicId,
    patientId: PatientId,
    details: EditablePatientDetails,
  ): Promise<boolean>;
}

/**
 * Reading patients, scoped to one clinic.
 *
 * Every method takes a `ClinicId`, and no method can be called without one. That
 * is the whole safety story of multi-tenancy in this application: there is no
 * overload without a clinic and no way to reach a patient you were not given a
 * clinic for (ADR 0014).
 *
 * The read methods return *read models* rather than the `Patient` entity. A
 * profile is the patient plus their appointments, visits, outstanding treatment
 * and balance, which is an aggregate no single row holds — and returning an
 * entity for it would mean pretending those columns belong to the patient.
 */
export interface PatientRepository extends PatientWriteRepository {
  /**
   * One page of the clinic's patients, plus the unpaged total.
   *
   * The total is returned rather than counted separately by the caller because the
   * UI needs it for the page control, and computing it against a page of rows
   * instead of the filtered set is how a list ends up claiming nine pages of one.
   */
  search(clinicId: ClinicId, query: PatientSearchQuery): Promise<Page<PatientListEntry>>;

  /**
   * The clinical profile, or `undefined` when this clinic holds no such patient.
   *
   * Anonymised records are not patients any more and are excluded here exactly as
   * they are on write, so the two directions cannot disagree about whether a
   * withdrawn record exists.
   */
  findProfile(clinicId: ClinicId, patientId: PatientId): Promise<PatientProfile | undefined>;

  /**
   * The odontogram chart, or `undefined` when this clinic holds no such patient.
   *
   * `undefined` and an empty chart are different answers: the first is a 404, the
   * second is a patient whose teeth have never been charted.
   */
  findOdontogram(clinicId: ClinicId, patientId: PatientId): Promise<PatientOdontogram | undefined>;
}

/**
 * Reading the clinic's book.
 *
 * Every method takes a `ClinicId`, for the same reason `PatientRepository` does:
 * there is no overload without one (ADR 0014).
 *
 * This interface used to declare five methods — `findById`, `findOverlapping`,
 * `findForPatient`, `updateStatus` and `save` — none of which anything called,
 * because nothing implemented them. The patients port had the same problem, and
 * its speculative methods turned out to be an alibi: the read routes went on
 * querying Drizzle themselves for years. Only the method the agenda endpoint
 * actually calls is declared here, and the others arrive with the slice that
 * needs them.
 */
export interface AppointmentRepository extends AppointmentWriteRepository {
  /**
   * Every appointment overlapping `window`, in start order.
   *
   * Half-open `[from, to)` on both the window and each appointment's own extent,
   * so an appointment may *overlap* the window without starting inside it. A
   * 23:30 booking that runs past midnight belongs on both days' agendas, and
   * filtering on `starts_at` alone would hide it from the second.
   *
   * Cancelled and no-show appointments are included: they were on the calendar
   * and a receptionist needs to see that a slot is deliberately empty rather than
   * free. Whether a status *reserves* a slot is a scheduling question, answered
   * by `reservesSchedulingSlot`, not a listing question.
   */
  findAgenda(clinicId: ClinicId, window: AgendaWindow): Promise<readonly AgendaEntry[]>;

  /**
   * One appointment as this clinic holds it, or `undefined` when it holds no such
   * appointment.
   *
   * The entity rather than an `AgendaEntry`, because the use cases that need this
   * are answering questions about an appointment's own record — when it was last
   * touched, why it was cancelled — not about how to draw it. An appointment that
   * belongs to another clinic is `undefined`, not a foreign record.
   */
  findById(clinicId: ClinicId, appointmentId: AppointmentId): Promise<Appointment | undefined>;

  /**
   * One appointment as the agenda's own query would return it, or `undefined`.
   *
   * It exists so that a write can answer with the row the screen will show. The
   * difference from `findById` is the join: this one names the patient and the
   * dentist and computes the end time, which is what a calendar needs, and an
   * entity is not it. Same query as `findAgenda` and one row, so the two cannot
   * disagree about a booking (ADR 0011).
   */
  findEntryById(clinicId: ClinicId, appointmentId: AppointmentId): Promise<AgendaEntry | undefined>;

  /**
   * Every appointment overlapping `window`, as entities.
   *
   * This exists only to feed the conflict check, and that is why it is half-open
   * on the same interval `findAgenda` uses: the agenda and the checker must ask
   * the overlap question the same way, or a slot the agenda calls free is one the
   * checker calls taken (ADR 0017).
   *
   * Cancelled and no-show rows are returned rather than filtered out. They hold
   * no slot — that is `reservesSchedulingSlot`'s job, and it is a rule about
   * statuses, not about listing — and a repository that quietly dropped them
   * would make the two questions look like one.
   */
  findOverlapping(clinicId: ClinicId, window: AppointmentWindow): Promise<readonly Appointment[]>;
}

/**
 * Writing the clinic's book.
 *
 * Separate from the read methods for the same reason `PatientWriteRepository` is
 * (ADR 0015): the guarantees these three methods have to keep — one statement per
 * write, the clinic scope in the `WHERE` clause, the exclusion constraint
 * translated rather than swallowed — are the ones worth stating on their own
 * interface, where nothing else has to be read past to find them.
 *
 * Every method takes a `ClinicId`, and a row outside it is `undefined` or a
 * no-op: an appointment belonging to another clinic must be indistinguishable
 * from one that does not exist (ADR 0014).
 *
 * **No method here may accept an appointment that already breaks a scheduling
 * rule.** A conflict is refused by PostgreSQL's exclusion constraints, and these
 * methods translate that refusal into `SCHEDULING_CONFLICT` rather than letting
 * it escape as a 500 — but translating it is a courtesy for the race the domain
 * cannot see, not the mechanism that keeps the book double-book-free. The
 * constraints are (ADR 0018).
 */
export interface AppointmentWriteRepository {
  /**
   * Insert a new appointment, or refuse it.
   *
   * Rejects with `SCHEDULING_CONFLICT` when the row overlaps another for the same
   * dentist or chair, and with `INVALID_REFERENCE` when the patient, dentist or
   * chair is not in this clinic. Both are facts about the write, not faults of
   * the caller, and they are raised here rather than in the use case so that two
   * concurrent inserts collide in the database — the only place both of them are
   * visible at once.
   */
  insert(appointment: Appointment): Promise<Appointment>;

  /**
   * Move an existing appointment's time, dentist and chair, in one statement.
   *
   * Returns `undefined` when this clinic holds no such appointment, which is the
   * same answer as a row that belongs to another clinic. The status is *not*
   * touched: whether a schedule may change at all is a domain rule
   * (`isScheduleEditable`), and a repository that could set it would let a
   * cancelled appointment be quietly rebooked by a write that meant to move it.
   */
  replaceSchedule(appointment: Appointment): Promise<Appointment | undefined>;

  /**
   * Move an existing appointment to a new status, recording why when cancelled.
   *
   * `cancelledReason` is part of the signature rather than a field of the
   * appointment because a cancellation without a reason is a gap in the record:
   * "patient did not attend" and "clinic cancelled for a broken compressor" are
   * both cancellations and the front desk needs to tell them apart when someone
   * calls. Status and reason are written together or not at all.
   *
   * Returns `undefined` when this clinic holds no such appointment.
   */
  changeStatus(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
    status: AppointmentStatus,
    cancelledReason?: string,
  ): Promise<Appointment | undefined>;

  /**
   * Record that this appointment became a visit: set `visit_id` and move the status,
   * in one statement.
   *
   * A separate method rather than a `changeStatus` that also accepts a `visitId`,
   * because the two differ in what they mean. A status change is a decision anybody
   * may make; becoming a visit is one event with two effects, and it is written by
   * `startVisit` inside the transaction that writes the visit itself (ADR 0021). The
   * status is a parameter rather than fixed to `IN_TREATMENT` for the same reason
   * every other write takes one: the rule that decides it lives in the domain, and a
   * repository that decided it would be a rule in a persistence class.
   *
   * Returns `undefined` when this clinic holds no such appointment, which is what a
   * visit's own repository sees if the booking was deleted a moment earlier.
   */
  becomeVisit(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
    visitId: VisitId,
    status: AppointmentStatus,
  ): Promise<Appointment | undefined>;
}

export interface VisitRepository {
  findById(clinicId: ClinicId, visitId: VisitId): Promise<Visit | undefined>;
  findOpenForPatient(clinicId: ClinicId, patientId: PatientId): Promise<Visit | undefined>;
  findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Visit[]>;
  /**
   * Move a visit to a new status, with the end time the domain decided.
   *
   * `endedAt` is a parameter rather than something the repository works out, because
   * the time a visit ended is a clinical fact and the time the row was written is a
   * technical one: a visit closed at the end of a long appointment and saved at the
   * desk afterwards has an end time well before its `updated_at`. A repository that
   * stamped its own `new Date()` made the endpoint's answer and the row disagree by
   * however long the request took (ADR 0022).
   *
   * `null` means "this visit has no end time" and is written as such — reopening clears
   * it, and an omitted column would leave the previous end time on a visit whose status
   * says it is open again.
   */
  updateStatus(
    clinicId: ClinicId,
    visitId: VisitId,
    status: VisitStatus,
    endedAt: IsoDateTime | null,
  ): Promise<void>;

  /**
   * Write a visit that the domain has already built.
   *
   * Named `save` rather than `insert` to match the sibling prescription and payment
   * ports, and it is only ever used as an insert: the visit that arrives here was
   * just created by `startVisitFromAppointment`, and the unique index on
   * `appointment_id` is what refuses a second one for the same booking.
   */
  save(visit: Visit): Promise<void>;
}

/**
 * The notes written on one visit.
 *
 * **`save` takes no `clinicId`, unlike every write above it**, and the reason is the
 * table's: `clinical_notes` has no clinic column. The visit the note names is the
 * tenant key, so the use case reads that visit in this clinic *before* saving, and a
 * `save` whose visit has since vanished must answer `NOT_FOUND` rather than a foreign
 * key error reaching the API as a 500.
 *
 * `findForVisit` does take one, because a read has no use case in front of it to scope
 * with: it joins `visits` on the note's `visit_id` and filters the clinic there, so
 * the scoping cannot be forgotten by a future caller (ADR 0014). Oldest first — the
 * order a clinical record is read in, and the repository's to decide (ADR 0023).
 */
export interface ClinicalNoteRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly ClinicalNote[]>;
  save(note: ClinicalNote): Promise<void>;
}

/**
 * The files attached to a visit — the repository half of `visit-attachments.ts`.
 *
 * Exactly the notes contract: reads scope through the visit's clinic (never
 * trust the caller for a read), writes are one row, and oldest first is the
 * order a clinical record is read in.
 */
export interface VisitAttachmentRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly VisitAttachment[]>;
  save(attachment: VisitAttachment): Promise<void>;
}

/**
 * A clinician the clinic can book.
 *
 * **What this shape lost, and why.** It used to promise `specialties: string[]` and
 * `defaultChairId`, neither of which any column can supply: `dentists.speciality` is
 * a single text value, and there is nowhere to store a default chair. A port that
 * describes a table that does not exist is not a design, it is a guess that the first
 * implementer has to either invent a migration for or quietly drop. `speciality` is
 * now the one value the row holds, and a default chair comes back when a column for
 * it exists — it is a migration, not a type.
 *
 * `licenceNumber` is deliberately **absent**. A list of bookable clinicians has no
 * use for a licence number, and a shape that returns the whole row is a shape that
 * eventually gets sent somewhere it should not be.
 */
export interface DentistSummary {
  readonly id: DentistId;
  /** Null for a clinician with no login: `user_id` is `on delete set null`. */
  readonly userId: string | null;
  readonly fullName: string;
  /** The one speciality the row holds, or null. Never an empty string. */
  readonly speciality: string | null;
  /**
   * The colour the clinic gives this clinician, or null.
   *
   * Read here rather than invented in the UI because two dentists sharing a chip
   * colour on the agenda's filter is a bug the clinic cannot fix without a
   * deployment.
   */
  readonly color: string | null;
  /**
   * False once the clinician has left.
   *
   * Carried rather than filtered out: a deactivated dentist still appears on
   * appointments booked while they worked, and hiding the row would leave the agenda
   * naming nobody.
   */
  readonly isActive: boolean;
}

/**
 * Asking for a clinic's clinicians.
 *
 * An object rather than a bare boolean, because a call site reading
 * `listByClinic(id, true)` says nothing about which true it means.
 */
export interface DentistListRequest {
  /** Undefined means *no filter*: every dentist, active or not. */
  readonly onlyActive?: boolean;
}

export interface DentistRepository {
  listByClinic(
    clinicId: ClinicId,
    request?: DentistListRequest,
  ): Promise<readonly DentistSummary[]>;
  findById(clinicId: ClinicId, dentistId: DentistId): Promise<DentistSummary | undefined>;
}

/** A treatment unit (sillón) the clinic books into. */
export interface ChairSummary {
  readonly id: ChairId;
  /** Null for a chair not assigned to a room; the column is `on delete set null`. */
  readonly roomId: string | null;
  /** The room's name, or null with no room. Never an id offered as a label. */
  readonly roomName: string | null;
  readonly name: string;
  readonly isActive: boolean;
}

/**
 * A chair with no room is still a chair: `rooms` is optional on the row, so the
 * filter is the same question it is for a dentist and is answered the same way.
 */
export interface ChairListRequest {
  /** Undefined means *no filter*: every chair, active or not. */
  readonly onlyActive?: boolean;
}

export interface ChairRepository {
  listByClinic(clinicId: ClinicId, request?: ChairListRequest): Promise<readonly ChairSummary[]>;
  /**
   * One chair of this clinic, or `undefined`.
   *
   * Added for the same reason the dentist port has it: a write that names a chair
   * has to know whether it can be booked, and `listByClinic` cannot answer that
   * without asking for the whole clinic's furniture and matching an id by hand.
   *
   * A chair in another clinic is `undefined`, not refused — see
   * `DentistRepository.findById`.
   */
  findById(clinicId: ClinicId, chairId: ChairId): Promise<ChairSummary | undefined>;
}

/**
 * The clinic itself: who it is, where its day starts, and when it is open.
 *
 * `updateOperatingHours` used to be declared here and never implemented, because
 * nothing called it either. It returns with the settings slice that owns the form
 * for it, for the same reason the appointment port stopped declaring methods with
 * no caller: a port that promises writes nobody asked for is a promise the first
 * implementer has to keep or break loudly.
 */
export interface ClinicRepository {
  findById(clinicId: ClinicId): Promise<Clinic | undefined>;
  /**
   * The clinic a request is scoped to when there is no authenticated user yet.
   *
   * It exists because `request.clinicId` still comes from `CLINIC_ID`; it is not a
   * fallback to be grown into a "default clinic" concept, and it disappears with
   * authentication.
   */
  getDefault(): Promise<Clinic | undefined>;
}

/**
 * One entry in the treatment catalogue, as the table holds it.
 *
 * **What this shape lost in session 30.** It used to declare `category`, and no column
 * supplies one — `treatments` has never had a category column, and the domain's own
 * `Treatment` type still lists `TREATMENT_CATEGORIES` as an aspiration with nowhere to
 * store it. A port that describes a table that does not exist is a guess the first
 * implementer would have to invent a migration for, so `category` is gone until the
 * catalogue's category column exists (a Milestone 8 question). `code` and
 * `defaultDurationMinutes` are nullable because the columns are; `description` and
 * `isActive` are returned because a picker needs to show both without a second query.
 */
export interface TreatmentCatalogueItem {
  readonly id: TreatmentId;
  /** Unique per clinic, and nullable — a catalogue may have unnamed rows. */
  readonly code: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly defaultDurationMinutes: number | null;
  /** Base price in minor units of the clinic currency. Never a float. */
  readonly defaultPriceMinor: number;
  /** Returned as a fact; what may still be *performed* is the use case's business. */
  readonly isActive: boolean;
}

export interface TreatmentRepository {
  listByClinic(clinicId: ClinicId): Promise<readonly TreatmentCatalogueItem[]>;
  findById(
    clinicId: ClinicId,
    treatmentId: TreatmentId,
  ): Promise<TreatmentCatalogueItem | undefined>;
}

/**
 * A treatment performed in a visit — the clinical record, not the catalogue.
 *
 * `visit_treatment_executions` has no `clinic_id`, so tenancy comes through `visits`,
 * exactly as it does for a clinical note: `findForVisit` joins the visit and filters
 * the clinic in the same statement, because a read has no use case in front of it to
 * scope with (ADR 0014). Oldest first, the order a clinical record is read in.
 *
 * `save` takes no clinic, because the use case has already resolved both the visit and
 * the treatment. What it cannot know is whether the treatment still exists by the time
 * the insert lands, so the one refusal it translates is the foreign key — a treatment
 * deleted between the read and the insert answers the same `INVALID_INPUT` the read
 * would have, rather than a `23503` reaching the API as a 500.
 */
export interface TreatmentRecordRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly TreatmentRecord[]>;
  save(record: TreatmentRecord): Promise<void>;
}

/**
 * A medication prescribed on a visit — the clinical record's third companion.
 *
 * Like `clinical_notes` and `visit_treatment_executions`, `prescriptions` has no
 * `clinic_id`, so tenancy comes through `visits`: `findForVisit` joins the visit and
 * filters the clinic in the same statement, because a read has no use case in front
 * of it to scope with (ADR 0014). Issued-first, then by id — the order a course of
 * medication is handed over in.
 *
 * `save` takes no clinic, because the use case has already resolved the visit. What
 * it cannot know is whether the visit still exists by the time the insert lands, so
 * the one refusal it translates is the foreign key — a visit deleted between the read
 * and the insert answers the same `NOT_FOUND` the read would have, rather than a
 * `23503` reaching the API as a 500.
 */
export interface PrescriptionRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Prescription[]>;
  save(prescription: Prescription): Promise<void>;
}

/**
 * A priceable clinical event recorded on a visit.
 *
 * **The first billing row in the patient's clinical record, and the first with a
 * `clinic_id` of its own** — the reason this port differs from its clinical siblings.
 * `findForVisit` scopes in the statement on the charge's own column rather than
 * through a join, but the charge still belongs to the visit: a read has no use case
 * in front of it to resolve the subject first, so the clinic filter is where the
 * visit's tenancy is double-checked, defence in depth on a read (ADR 0014). Oldest
 * first, then by id — the order a bill grew in.
 *
 * `save` takes no clinic, because the use case has already resolved the visit in this
 * clinic. What it cannot know is whether that visit still exists by the time the
 * insert lands, so the one refusal it translates is the foreign key — a visit deleted
 * between the read and the insert answers the same `NOT_FOUND` the read would have,
 * rather than a `23503` (or its SQLite twin) reaching the API as a 500.
 *
 * `markInvoiced` is the write that ends a charge's "not yet billed" story. It is a
 * batch over specific ids, scoped by the clinic like every other read and write on
 * this row: the use case read the charges inside its transaction in this clinic, and
 * the update repeats that filter because an update has no use case in front of it to
 * scope with. Setting `invoice_id` and `invoiced_at` is the whole operation — a
 * charge folded into an invoice is never unpublished, and there is no inverse.
 */
export interface ChargeRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Charge[]>;
  save(charge: Charge): Promise<void>;
  markInvoiced(
    clinicId: ClinicId,
    chargeIds: readonly ChargeId[],
    invoiceId: InvoiceId,
    invoicedAt: IsoDateTime,
  ): Promise<void>;
}

/**
 * One issued invoice, written whole.
 *
 * The persistence is deliberately a single `save`. An invoice is a legal document
 * whose totals are written down, not derived on read (the `invoices` table persists
 * `subtotal_minor` and `total_minor` on purpose), and nothing in this milestone
 * edits or retires one — reading invoices is Milestone 9's ledger, not this task.
 * The implementation computes the totals through the domain's own
 * `calculateInvoiceTotals`, so a number stored twice cannot disagree with a number
 * derived once.
 *
 * `save` takes no clinic, because the use case has already resolved the visit and the
 * clinic inside its transaction. The translated refusal is the foreign key — the
 * patient deleted between the read and the insert answers `NOT_FOUND` rather than a
 * `23503` reaching the API as a 500.
 */
export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;
}

/**
 * Money received, scoped to one clinic, and the rows that allocated it.
 *
 * `save` inserts a payment; its only translated refusal is the patient's foreign key,
 * for the same "deleted between the read and the insert" reason every other write
 * here translates it.
 *
 * `findForVisit` is the read that answers a visit's payment register, and it is a
 * join because a payment does not carry a `visit_id`: the money reaches the visit
 * through its allocations, its invoice, and the charges that invoice folded in. A
 * payment recorded for a patient who never paid this visit's bill cannot appear here.
 * Newest received first, then by id — the order a payment register is read in.
 */
export interface PaymentRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Payment[]>;
  save(payment: Payment): Promise<void>;
}

/**
 * The line that says an invoice was paid with a payment.
 *
 * A payment may be split across invoices and an invoice settled by several payments,
 * which is why the allocations are their own table with a composite primary key — a
 * duplicate split is impossible at the database, not merely discouraged. Nothing in
 * this milestone edits or recalls an allocation, so `save` is the whole port.
 */
export interface PaymentAllocationRepository {
  save(allocation: PaymentAllocation): Promise<void>;
}

/** Read access to a user's clinic memberships; authorization is enforced here. */
export interface ClinicMembership {
  readonly clinicId: ClinicId;
  readonly role: ClinicRole;
}

export interface ClinicMembershipRepository {
  listForUser(userId: string): Promise<readonly ClinicMembership[]>;
}
