/**
 * Read models for the patient feature.
 *
 * These are the shapes the product actually serves, named once here so the API
 * route, the typed client and the UI all describe the same thing. That matters
 * more than it sounds: the profile response used to be built by spreading a
 * database row, which meant the published JSON was whatever the `patients` table
 * happened to contain — adding a column silently added it to the response, and
 * `anonymized_at` was being sent to the browser on every profile load.
 *
 * A read model is deliberately *not* the `Patient` entity. The entity is what a
 * write accepts and what the domain reasons about; a profile additionally carries
 * the next appointment, recent visits, outstanding work and a balance, which no
 * single row holds. Conflating them would either make the entity unusable for
 * writes or make the profile unable to describe an aggregate.
 *
 * Two conventions throughout:
 *
 *  - **Optional values are `| null`, never `undefined`.** A column that is NULL is
 *    a fact the UI has to render ("no email recorded"), and `undefined` invites a
 *    missing key to be read as an absent one.
 *  - **Money is minor units** — an integer count of cents, never a decimal or a
 *    float. See `packages/domain/src/billing/money.ts`; formatting is a display
 *    concern and happens once, at the edge.
 */

import type {
  AppointmentId,
  ClinicId,
  DentistId,
  IsoDate,
  IsoDateTime,
  PatientId,
  TreatmentPlanId,
  VisitId,
} from '@denti-code-u3/types';

/**
 * One row in the patient list.
 *
 * Not the whole record, and not `fullName`: the list needs enough to recognise a
 * patient and reach them, and a receptionist scanning forty rows is helped by the
 * record number and phone far more than by a spelled-out name they already read.
 */
export interface PatientListEntry {
  readonly id: PatientId;
  /** The clinic's chart number. NULL for rows created before numbers existed. */
  readonly recordNumber: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly birthDate: IsoDate | null;
  readonly isActive: boolean;
  readonly createdAt: IsoDateTime;
}

/**
 * The profile: the record plus the clinical context a clinician needs on open.
 *
 * Assembled as one response because a profile built from five round trips renders
 * half-empty in practice — the remaining sections arrive after the frame that
 * shows them.
 */
export interface PatientProfile extends PatientListEntry {
  readonly clinicId: ClinicId;
  readonly identificationNumber: string | null;
  readonly address: string | null;
  /**
   * Free text, and shown on its own rather than folded into a "medical history"
   * line: an allergy is the one field on this page where a clinician must not
   * have to go looking.
   */
  readonly allergies: string | null;
  /** Clinic-specific extras the domain does not model. Never interpreted here. */
  readonly additionalData: Record<string, unknown>;
  readonly updatedAt: IsoDateTime;
  /** The next scheduled appointment, or null when none is booked. */
  readonly upcomingAppointment: PatientUpcomingAppointment | null;
  /** Most recent first. A bounded window, not the patient's whole history. */
  readonly recentVisits: readonly PatientVisitSummary[];
  readonly outstandingTreatments: readonly PatientOutstandingTreatment[];
  readonly financialBalance: PatientFinancialBalance;
}

export interface PatientUpcomingAppointment {
  readonly id: AppointmentId;
  readonly startsAt: IsoDateTime;
  readonly durationMinutes: number;
  readonly status: string;
  readonly dentistId: DentistId | null;
}

export interface PatientVisitSummary {
  readonly id: VisitId;
  readonly status: string;
  readonly startedAt: IsoDateTime | null;
  readonly endedAt: IsoDateTime | null;
  readonly reason: string | null;
  readonly summary: string | null;
  readonly createdAt: IsoDateTime;
}

export interface PatientOutstandingTreatment {
  readonly id: string;
  readonly planId: TreatmentPlanId;
  readonly planStatus: string;
  readonly title: string | null;
  /** FDI notation, e.g. `16`. Null for treatment not tied to one tooth. */
  readonly tooth: string | null;
  readonly quantity: number;
  readonly estimatedPriceMinor: number;
}

export interface PatientFinancialBalance {
  /** Charges minus payments, in minor units. Negative means the patient is owed. */
  readonly outstandingMinor: number;
  readonly chargeCount: number;
  readonly currencyCode: string | null;
}

/** One tooth-level entry on the odontogram chart. */
export interface PatientOdontogramEntry {
  readonly id: string;
  /** `PERMANENT` or `DECIDUOUS`. */
  readonly dentition: string;
  /** FDI two-digit notation: quadrant then position, `11`–`48`. */
  readonly tooth: string;
  readonly surfaces: readonly string[];
  readonly condition: string;
  readonly notes: string | null;
  readonly recordedAt: IsoDateTime;
}

/**
 * The whole chart for one patient.
 *
 * Returned as an object rather than a bare array so the repository can answer
 * "no such patient in this clinic" with `undefined` and a real patient with an
 * empty chart with `{ entries: [] }`. A bare array cannot distinguish those, and
 * the difference is a 404.
 */
export interface PatientOdontogram {
  readonly entries: readonly PatientOdontogramEntry[];
}
