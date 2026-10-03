import type { ClinicId, IsoDate, PatientId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/id-generator.js';
import type { PatientWriteRepository } from '../ports/index.js';
import type { Patient } from './patient.js';
import {
  editablePatientDetailsFrom,
  type PatientDetailsInput,
} from './editable-patient-details.js';

export { assertPlausibleBirthDate } from './editable-patient-details.js';

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
export type RegisterPatientInput = PatientDetailsInput;

export interface RegisterPatientDependencies {
  readonly patients: PatientWriteRepository;
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

export async function registerPatient(
  clinicId: ClinicId,
  input: RegisterPatientInput,
  { patients, ids, clock }: RegisterPatientDependencies,
): Promise<RegisteredPatient> {
  // The rules are checked before anything is generated, so a rejected form cannot
  // consume an id or a record number.
  const details = editablePatientDetailsFrom(input, clock.now().slice(0, 10) as IsoDate);

  const patient: Patient = {
    id: ids.nextId() as PatientId,
    clinicId,
    ...details,
    // A newly registered patient is always active. There is no "register
    // someone as inactive" workflow, and starting one would create a chart that
    // cannot be found by search until someone remembers to activate it.
    isActive: true,
  };

  const { recordNumber } = await patients.register(patient);

  return { patient, recordNumber };
}
