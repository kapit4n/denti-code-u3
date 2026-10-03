import type { ClinicId, IsoDate, PatientId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError } from '../shared/errors.js';
import type { IdGenerator } from '../shared/id-generator.js';
import type { PatientRegistrationRepository } from '../ports/index.js';
import { assertValidBirthDate, type Patient } from './patient.js';

/**
 * Patient registration.
 *
 * A use case rather than a route handler because the rules below are business
 * rules, not transport concerns: the same rules must hold whether a patient is
 * registered by the web app, the desktop app, or a seeded script. They live here
 * so there is exactly one definition of "a patient may be registered".
 *
 * Dependencies are injected — the repository, the id generator and the clock —
 * so this is deterministic in tests and free of infrastructure imports. The
 * domain must not learn what PostgreSQL is (ADR 0004).
 */

/** What a receptionist supplies. Everything not listed here is derived. */
export interface RegisterPatientInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName?: string;
  readonly identificationNumber?: string;
  readonly phone?: string;
  readonly email?: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly birthDate?: IsoDate;
}

export interface RegisterPatientDependencies {
  readonly patients: PatientRegistrationRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface RegisteredPatient {
  readonly patient: Patient;
  /** Server-assigned; see `nextPatientRecordNumber`. */
  readonly recordNumber: string;
}

/**
 * The record number format the clinic quotes over the phone.
 *
 * Zero-padded to six digits, so `P-000001` sorts correctly as text and keeps its
 * width well past any plausible patient count.
 */
const RECORD_NUMBER_PREFIX = 'P-';
const RECORD_NUMBER_DIGITS = 6;

/**
 * Next record number for a clinic: the highest issued number plus one.
 *
 * A pure function of the numbers already issued. The uniqueness is enforced by
 * the `(clinic_id, record_number)` unique index and the counter is read under a
 * transaction-scoped advisory lock by the repository, so two receptionists
 * registering at the same moment cannot collide. That matters because the
 * alternative — letting the client choose — means either a duplicate-number
 * error in front of a patient, or gaps a human has to reconcile.
 */
export function nextPatientRecordNumber(issued: readonly string[]): string {
  const highest = issued.reduce((max, recordNumber) => {
    const digits = recordNumber.slice(RECORD_NUMBER_PREFIX.length);
    if (!/^\d+$/.test(digits)) {
      return max;
    }
    return Math.max(max, Number.parseInt(digits, 10));
  }, 0);

  return `${RECORD_NUMBER_PREFIX}${String(highest + 1).padStart(RECORD_NUMBER_DIGITS, '0')}`;
}

/**
 * Rejects a birth date that is not a real day, or that has not happened yet.
 *
 * The future check is separate from `assertValidBirthDate` because that one
 * answers "is this a date?" and this one answers "is it a date a patient could
 * have been born on?". A date of `2999-01-01` passes the first and fails the
 * second, and registering it would make every age calculation in the product
 * wrong for the life of the record.
 */
export function assertPlausibleBirthDate(birthDate: IsoDate, today: IsoDate): void {
  assertValidBirthDate(birthDate);
  if (birthDate > today) {
    throw new DomainError('INVALID_INPUT', 'birthDate cannot be in the future', {
      birthDate,
      today,
    });
  }
}

/** Trims and rejects a name that is empty once trimmed. */
function requireName(value: string, field: 'firstName' | 'lastName'): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${field} is required`, { field });
  }
  return trimmed;
}

/** Optional text: trimmed, and dropped entirely when it was only whitespace. */
function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function registerPatient(
  clinicId: ClinicId,
  input: RegisterPatientInput,
  { patients, ids, clock }: RegisterPatientDependencies,
): Promise<RegisteredPatient> {
  const birthDate = optionalText(input.birthDate);
  if (birthDate !== undefined) {
    assertPlausibleBirthDate(birthDate, clock.now().slice(0, 10));
  }

  const patientId = ids.nextId() as PatientId;

  const patient: Patient = {
    id: patientId,
    clinicId,
    firstName: requireName(input.firstName, 'firstName'),
    lastName: requireName(input.lastName, 'lastName'),
    preferredName: optionalText(input.preferredName),
    identificationNumber: optionalText(input.identificationNumber),
    phone: optionalText(input.phone),
    email: optionalText(input.email),
    birthDate,
    isActive: true,
  };

  const { recordNumber } = await patients.register(patient);

  return { patient, recordNumber };
}
