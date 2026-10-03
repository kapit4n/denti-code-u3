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
  ChairId,
  ClinicId,
  DentistId,
  IsoDateTime,
  PatientId,
  PaymentId,
  TreatmentId,
  VisitId,
} from '@denti-code-u3/types';
import type { Appointment, AppointmentStatus } from '../appointment/index.js';
import type { Visit, VisitStatus } from '../visit/index.js';
import type { Patient } from '../patient/index.js';
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

export interface PatientSearchCriteria {
  readonly clinicId: ClinicId;
  /** Matches name, phone or identification — the identifiers a receptionist knows. */
  readonly text?: string;
  readonly onlyActive?: boolean;
  readonly page?: PageRequest;
}

/**
 * The write side of patient persistence, which is all registration needs.
 *
 * Narrower than `PatientRepository` on purpose. The read endpoints predate the
 * repository layer and still query Drizzle directly in their route handlers;
 * implementing `search` and `findById` here today would add two methods that
 * nothing calls, which is dead code pretending to be structure. Reads move here
 * when they are next touched.
 *
 * One method rather than `save` plus `nextRecordNumber`, because the two must be
 * atomic together: reading the highest issued number and inserting a patient with
 * it are a single critical section, and a port that lets a caller drive them
 * separately cannot promise that. The caller therefore cannot choose a record
 * number even if it wanted to — which is right, since renumbering a patient's
 * chart is not something this product does.
 */
export interface PatientRegistrationRepository {
  /**
   * Stores a new patient and assigns its clinic-scoped record number.
   *
   * Returns the record number actually written. Implementations must be safe to
   * call concurrently: two receptionists registering at the same moment must not
   * produce the same number, because the unique index would then reject one of
   * them in front of a patient who is already at the desk.
   */
  register(patient: Patient): Promise<{ readonly recordNumber: string }>;
}

export interface PatientRepository extends PatientRegistrationRepository {
  findById(clinicId: ClinicId, patientId: PatientId): Promise<Patient | undefined>;
  search(criteria: PatientSearchCriteria): Promise<Page<Patient>>;
}

export interface AppointmentRangeQuery {
  readonly clinicId: ClinicId;
  /** Half-open interval `[startsAt, endsAt)`. */
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly dentistIds?: readonly DentistId[];
  readonly chairIds?: readonly ChairId[];
  readonly patientId?: PatientId;
}

export interface AppointmentRepository {
  findById(clinicId: ClinicId, appointmentId: AppointmentId): Promise<Appointment | undefined>;
  /** All appointments overlapping a window — the data the domain then checks. */
  findOverlapping(query: AppointmentRangeQuery): Promise<readonly Appointment[]>;
  findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Appointment[]>;
  updateStatus(
    clinicId: ClinicId,
    appointmentId: AppointmentId,
    status: AppointmentStatus,
  ): Promise<void>;
  save(appointment: Appointment): Promise<void>;
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
