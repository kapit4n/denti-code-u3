import type { ClinicId } from '@denti-code-u3/types';

import type { ClinicRepository } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import {
  assertValidTimeZone,
  type Clinic,
  type ClinicOperatingHours,
  type ClinicSettingsUpdate,
} from './clinic.js';

export interface UpdateClinicSettingsInput {
  readonly name: string;
  readonly legalName?: string | null;
  readonly taxId?: string | null;
  readonly address?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly timeZone: string;
  readonly currency: string;
  readonly operatingHours: readonly ClinicOperatingHours[];
}

export interface UpdateClinicSettingsDependencies {
  readonly clinics: ClinicRepository;
}

const LOCAL_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function requiredText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DomainError('INVALID_INPUT', 'This field is required', { field });
  }
  if (trimmed.length > maxLength) {
    throw new DomainError('INVALID_INPUT', 'This field is too long', { field });
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, field: string, maxLength: number) {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > maxLength) {
    throw new DomainError('INVALID_INPUT', 'This field is too long', { field });
  }
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseOperatingHours(
  hours: readonly ClinicOperatingHours[],
): readonly ClinicOperatingHours[] {
  const seen = new Set<number>();

  return hours
    .map((entry) => {
      if (!Number.isInteger(entry.weekday) || entry.weekday < 1 || entry.weekday > 7) {
        throw new DomainError('INVALID_INPUT', 'A weekday must be between 1 and 7', {
          field: 'operatingHours',
        });
      }
      if (seen.has(entry.weekday)) {
        throw new DomainError('INVALID_INPUT', 'A weekday may only be listed once', {
          field: 'operatingHours',
        });
      }
      seen.add(entry.weekday);

      if (entry.isClosed) {
        return {
          weekday: entry.weekday,
          opensAtLocalTime: '',
          closesAtLocalTime: '',
          isClosed: true,
        };
      }

      if (
        !LOCAL_TIME_PATTERN.test(entry.opensAtLocalTime) ||
        !LOCAL_TIME_PATTERN.test(entry.closesAtLocalTime)
      ) {
        throw new DomainError('INVALID_INPUT', 'Opening hours must be written as HH:MM', {
          field: 'operatingHours',
        });
      }
      if (entry.opensAtLocalTime >= entry.closesAtLocalTime) {
        throw new DomainError('INVALID_INPUT', 'Closing time must be after opening time', {
          field: 'operatingHours',
        });
      }

      return {
        weekday: entry.weekday,
        opensAtLocalTime: entry.opensAtLocalTime,
        closesAtLocalTime: entry.closesAtLocalTime,
        isClosed: false,
      };
    })
    .sort((left, right) => left.weekday - right.weekday);
}

export async function updateClinicSettings(
  clinicId: ClinicId,
  input: UpdateClinicSettingsInput,
  dependencies: UpdateClinicSettingsDependencies,
): Promise<Clinic> {
  const name = requiredText(input.name, 'name', 200);
  const currency = input.currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainError('INVALID_INPUT', 'A currency is a three-letter ISO code', {
      field: 'currency',
    });
  }

  assertValidTimeZone(input.timeZone.trim());

  const settings: ClinicSettingsUpdate = {
    name,
    legalName: optionalText(input.legalName, 'legalName', 200),
    taxId: optionalText(input.taxId, 'taxId', 50),
    address: optionalText(input.address, 'address', 500),
    phone: optionalText(input.phone, 'phone', 50),
    email: optionalText(input.email, 'email', 200),
    timeZone: input.timeZone.trim(),
    currency,
    operatingHours: normaliseOperatingHours(input.operatingHours),
  };

  const clinic = await dependencies.clinics.updateSettings(clinicId, settings);

  if (!clinic) {
    throw new DomainError('NOT_FOUND', 'The clinic could not be found', {
      entity: 'Clinic',
      id: clinicId,
    });
  }

  return clinic;
}
