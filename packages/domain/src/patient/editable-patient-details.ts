/**
 * The patient fields an edit may change, and the rules for turning what a
 * receptionist typed into them.
 *
 * Extracted from `registerPatient` because registering and editing share the same
 * rules — a name is required once trimmed, optional text is dropped rather than
 * stored blank, a birth date has to have happened. Two copies of those rules would
 * drift, and the drift would show up as a patient who could be created one way but
 * not edited another.
 */

import type { IsoDate } from '@denti-code-u3/types';

import { DomainError } from '../shared/errors.js';
import { assertValidBirthDate } from './patient.js';

/** What a receptionist supplies, before it has been checked. */
export interface PatientDetailsInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName?: string;
  readonly identificationNumber?: string;
  readonly phone?: string;
  readonly email?: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly birthDate?: IsoDate;
}

/**
 * The patient fields a caller may write.
 *
 * Deliberately narrower than `Patient`. An edit must not be able to change the
 * chart number, the active flag or the anonymisation timestamp, and expressing
 * that as "the type does not carry those fields" is stronger than a repository
 * remembering to leave three columns out of its `UPDATE`.
 *
 * Deactivating a patient is a separate, deliberate action rather than a field on
 * this form: it changes what the product may do with the record, and it is
 * reversible in a way a misspelled surname is not.
 */
export interface EditablePatientDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName?: string;
  readonly identificationNumber?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly birthDate?: IsoDate;
}

/**
 * Rejects a birth date that is not a real day, or that has not happened yet.
 *
 * The future check is separate from `assertValidBirthDate` because that one
 * answers "is this a date?" and this one answers "is it a date a patient could
 * have been born on?". A date of `2999-01-01` passes the first and fails the
 * second, and storing it would make every age calculation in the product wrong for
 * the life of the record.
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

/**
 * Check and normalise typed details.
 *
 * `today` comes from the injected clock rather than `new Date()`, so the rule is
 * testable and so the domain does not read ambient time.
 */
export function editablePatientDetailsFrom(
  input: PatientDetailsInput,
  today: IsoDate,
): EditablePatientDetails {
  const birthDate = optionalText(input.birthDate);
  if (birthDate !== undefined) {
    assertPlausibleBirthDate(birthDate, today);
  }

  return {
    firstName: requireName(input.firstName, 'firstName'),
    lastName: requireName(input.lastName, 'lastName'),
    preferredName: optionalText(input.preferredName),
    identificationNumber: optionalText(input.identificationNumber),
    phone: optionalText(input.phone),
    email: optionalText(input.email),
    birthDate,
  };
}

/** Trims and rejects a name that is empty once trimmed. */
function requireName(value: string, field: 'firstName' | 'lastName'): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', `${field} is required`, { field });
  }
  return trimmed;
}

/**
 * Optional text: trimmed, and dropped entirely when it was only whitespace.
 *
 * Dropping rather than storing `''` matters: an empty string is a value that
 * renders as a blank line in the profile and is indistinguishable from "not
 * known" once it has been through two screens.
 */
function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
