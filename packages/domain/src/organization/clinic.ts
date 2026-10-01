import type { CurrencyCode, TimeZone } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

export interface ClinicOperatingHours {
  /** 1 = Monday … 7 = Sunday, ISO-8601 ordering. */
  readonly weekday: number;
  readonly opensAtLocalTime: string;
  readonly closesAtLocalTime: string;
  readonly isClosed: boolean;
}

export interface Clinic {
  readonly id: string;
  readonly name: string;
  readonly legalName?: string;
  readonly timeZone: TimeZone;
  readonly currency: CurrencyCode;
  readonly operatingHours: readonly ClinicOperatingHours[];
  readonly settings: Readonly<Record<string, unknown>>;
}

export function isValidTimeZone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(candidate: string): void {
  if (!isValidTimeZone(candidate)) {
    throw new DomainError('INVALID_INPUT', `"${candidate}" is not a valid IANA time zone`, {
      timeZone: candidate,
    });
  }
}

export function operatingHoursFor(clinic: Clinic, weekday: number): ClinicOperatingHours {
  const hours = clinic.operatingHours.find((candidate) => candidate.weekday === weekday);
  if (!hours || hours.isClosed) {
    throw new DomainError('OUTSIDE_OPERATING_HOURS', `The clinic is closed on weekday ${weekday}`, {
      clinicId: clinic.id,
      weekday,
    });
  }
  return hours;
}
