import type { IsoDate, PatientId } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

/**
 * The patient is the primary clinical subject: every visit, appointment,
 * treatment and charge belongs to exactly one patient.
 */
export interface Patient {
  readonly id: PatientId;
  readonly clinicId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName?: string;
  readonly identificationNumber?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly birthDate?: IsoDate;
  readonly isActive: boolean;
  readonly deletedAt?: string;
}

export function patientFullName(patient: Patient): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

/** Name used in clinical lists and printouts. */
export function patientDisplayName(patient: Patient): string {
  return patient.preferredName ?? patientFullName(patient);
}

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidBirthDate(birthDate: string): void {
  if (!BIRTH_DATE_PATTERN.test(birthDate)) {
    throw new DomainError('INVALID_INPUT', 'birthDate must be an ISO calendar date', { birthDate });
  }
  const parsed = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate) {
    throw new DomainError('INVALID_INPUT', `"${birthDate}" is not a real calendar date`, {
      birthDate,
    });
  }
}

export function patientAgeInYears(patient: Patient, today: IsoDate): number {
  const birthDate = patient.birthDate;
  if (!birthDate) {
    throw new DomainError('INVALID_INPUT', `Patient ${patient.id} has no birth date`, {
      patientId: patient.id,
    });
  }
  assertValidBirthDate(birthDate);

  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number) as [
    number,
    number,
    number,
  ];

  let age = todayYear - birthYear;
  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) {
    age -= 1;
  }
  return age;
}

export function isActivePatient(patient: Patient): boolean {
  return patient.isActive && !patient.deletedAt;
}
