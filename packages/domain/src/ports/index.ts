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
  ChairId,
  ClinicId,
  DentistId,
  IsoDateTime,
  PatientId,
  PaymentId,
  TreatmentId,
  VisitId,
} from '@denti-code-u3/types';
import type { AgendaEntry, AgendaWindow } from '../appointment/index.js';
import type { Visit, VisitStatus } from '../visit/index.js';
import type {
  EditablePatientDetails,
  Patient,
  PatientListEntry,
  PatientOdontogram,
  PatientProfile,
} from '../patient/index.js';
import type { Clinic, ClinicOperatingHours, ClinicRole } from '../organization/index.js';
import type { Prescription } from '../prescription/index.js';

/**
 * Transaction boundary. A use case that must write several rows atomically
 * receives a `UnitOfWork` instead of calling repositories directly.
 */
export interface UnitOfWork {
  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}

export interface Repositories {
  readonly patients: PatientRepository;
  readonly appointments: AppointmentRepository;
  readonly visits: VisitRepository;
  readonly clinics: ClinicRepository;
  readonly dentists: DentistRepository;
  readonly chairs: ChairRepository;
  readonly treatments: TreatmentRepository;
  readonly prescriptions: PrescriptionRepository;
  readonly payments: PaymentRepository;
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
export interface AppointmentRepository {
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
}

export interface VisitRepository {
  findById(clinicId: ClinicId, visitId: VisitId): Promise<Visit | undefined>;
  findOpenForPatient(clinicId: ClinicId, patientId: PatientId): Promise<Visit | undefined>;
  findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Visit[]>;
  updateStatus(clinicId: ClinicId, visitId: VisitId, status: VisitStatus): Promise<void>;
  save(visit: Visit): Promise<void>;
}

export interface DentistSummary {
  readonly id: DentistId;
  readonly userId: string;
  readonly fullName: string;
  readonly specialties: readonly string[];
  readonly defaultChairId?: ChairId;
}

export interface DentistRepository {
  listByClinic(clinicId: ClinicId): Promise<readonly DentistSummary[]>;
  findById(clinicId: ClinicId, dentistId: DentistId): Promise<DentistSummary | undefined>;
}

export interface ChairSummary {
  readonly id: ChairId;
  readonly roomId?: string;
  readonly name: string;
  readonly kind: string;
  readonly isActive: boolean;
}

export interface ChairRepository {
  listByClinic(clinicId: ClinicId): Promise<readonly ChairSummary[]>;
}

export interface ClinicRepository {
  findById(clinicId: ClinicId): Promise<Clinic | undefined>;
  getDefault(): Promise<Clinic | undefined>;
  updateOperatingHours(
    clinicId: ClinicId,
    operatingHours: readonly ClinicOperatingHours[],
  ): Promise<void>;
}

export interface TreatmentCatalogueItem {
  readonly id: TreatmentId;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly defaultDurationMinutes: number;
  readonly defaultPriceMinor: number;
}

export interface TreatmentRepository {
  listByClinic(clinicId: ClinicId): Promise<readonly TreatmentCatalogueItem[]>;
  findById(
    clinicId: ClinicId,
    treatmentId: TreatmentId,
  ): Promise<TreatmentCatalogueItem | undefined>;
}

export interface PrescriptionRepository {
  findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Prescription[]>;
  save(prescription: Prescription): Promise<void>;
}

export interface PaymentSummary {
  readonly id: PaymentId;
  readonly patientId: PatientId;
  readonly method: string;
  readonly amountMinor: number;
  readonly receivedAt: IsoDateTime;
}

export interface PaymentRepository {
  listForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly PaymentSummary[]>;
  save(payment: PaymentSummary): Promise<void>;
}

/** Read access to a user's clinic memberships; authorization is enforced here. */
export interface ClinicMembership {
  readonly clinicId: ClinicId;
  readonly role: ClinicRole;
}

export interface ClinicMembershipRepository {
  listForUser(userId: string): Promise<readonly ClinicMembership[]>;
}
