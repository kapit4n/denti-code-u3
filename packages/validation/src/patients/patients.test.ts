import { describe, expect, it } from 'vitest';
import {
  createPatientFormSchema,
  createPatientSchema,
  paginatedPatientSchema,
  searchPatientsQuerySchema,
  updatePatientSchema,
} from './index.js';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const PATIENT_ID = '22222222-2222-4222-8222-222222222222';

describe('createPatientSchema', () => {
  it('accepts a minimal patient', () => {
    const result = createPatientSchema.safeParse({ firstName: 'Ana', lastName: 'Gómez' });

    expect(result.success).toBe(true);
  });

  it('trims whitespace around names', () => {
    const result = createPatientSchema.parse({ firstName: '  Ana  ', lastName: ' Gómez ' });

    expect(result.firstName).toBe('Ana');
    expect(result.lastName).toBe('Gómez');
  });

  it('rejects a blank name', () => {
    expect(createPatientSchema.safeParse({ firstName: '   ', lastName: 'Gómez' }).success).toBe(
      false,
    );
    expect(createPatientSchema.safeParse({ firstName: 'Ana', lastName: '' }).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = createPatientSchema.safeParse({
      firstName: 'Ana',
      lastName: 'Gómez',
      email: 'not-an-email',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO birth date', () => {
    const result = createPatientSchema.safeParse({
      firstName: 'Ana',
      lastName: 'Gómez',
      birthDate: '30/09/1990',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a phone number containing letters', () => {
    const result = createPatientSchema.safeParse({
      firstName: 'Ana',
      lastName: 'Gómez',
      phone: '+54 9 11 5555 CALL',
    });

    expect(result.success).toBe(false);
  });
});

describe('updatePatientSchema', () => {
  it('accepts a partial update', () => {
    const result = updatePatientSchema.safeParse({ phone: '+54 9 11 5555 1234' });

    expect(result.success).toBe(true);
  });

  it('accepts an empty update', () => {
    expect(updatePatientSchema.safeParse({}).success).toBe(true);
  });
});

describe('searchPatientsQuerySchema', () => {
  it('coerces numeric query parameters and applies defaults', () => {
    const result = searchPatientsQuerySchema.parse({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(result.q).toBeUndefined();
  });

  it('coerces string query parameters into numbers', () => {
    const result = searchPatientsQuerySchema.parse({ page: '3', pageSize: '50' });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it('rejects a page beyond the maximum page size', () => {
    expect(searchPatientsQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('rejects an empty search term', () => {
    expect(searchPatientsQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('parses the onlyActive flag', () => {
    expect(searchPatientsQuerySchema.parse({ onlyActive: 'true' }).onlyActive).toBe(true);
    expect(searchPatientsQuerySchema.parse({ onlyActive: 'false' }).onlyActive).toBe(false);
  });
});

describe('paginatedPatientSchema', () => {
  it('accepts a well-formed page', () => {
    const result = paginatedPatientSchema.safeParse({
      data: [
        {
          id: PATIENT_ID,
          clinicId: CLINIC_ID,
          firstName: 'Ana',
          lastName: 'Gómez',
          isActive: true,
          fullName: 'Ana Gómez',
        },
      ],
      meta: { page: 1, pageSize: 25, total: 1 },
    });

    expect(result.success).toBe(true);
  });

  it('rejects a page missing its meta block', () => {
    const result = paginatedPatientSchema.safeParse({ data: [] });

    expect(result.success).toBe(false);
  });
});

describe('createPatientFormSchema', () => {
  it('accepts a patient with every optional field left blank', () => {
    // The regression this exists for: an untouched text input submits '', and ''
    // is not a valid `preferredName`, so a patient who gave no email and no
    // phone could not be registered at all.
    const result = createPatientFormSchema.safeParse({
      firstName: 'Ana',
      lastName: 'Gómez',
      preferredName: '',
      identificationNumber: '',
      phone: '',
      email: '',
      birthDate: '',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ firstName: 'Ana', lastName: 'Gómez' });
  });

  it('treats a whitespace-only optional field as blank', () => {
    const result = createPatientFormSchema.parse({
      firstName: 'Ana',
      lastName: 'Gómez',
      preferredName: '   ',
    });

    expect(result.preferredName).toBeUndefined();
  });

  it('still validates optional fields that were filled in', () => {
    // The pre-processing must not become a way to smuggle anything past the
    // schema: a bad email is still rejected.
    expect(
      createPatientFormSchema.safeParse({
        firstName: 'Ana',
        lastName: 'Gómez',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });

  it('still requires a name', () => {
    expect(createPatientFormSchema.safeParse({ firstName: '', lastName: 'Gómez' }).success).toBe(
      false,
    );
    expect(createPatientFormSchema.safeParse({ firstName: 'Ana', lastName: '  ' }).success).toBe(
      false,
    );
  });

  it('trims real values', () => {
    const result = createPatientFormSchema.parse({
      firstName: '  Ana ',
      lastName: ' Gómez  ',
      preferredName: '  Ana María ',
    });

    expect(result).toEqual({
      firstName: 'Ana',
      lastName: 'Gómez',
      preferredName: 'Ana María',
    });
  });

  it('rejects a birth date that is not a real date', () => {
    expect(
      createPatientFormSchema.safeParse({
        firstName: 'Ana',
        lastName: 'Gómez',
        birthDate: '1990-02-30',
      }).success,
    ).toBe(false);
  });

  it('has exactly the fields of createPatientSchema, so it cannot drift', () => {
    // If someone adds a field to `createPatientSchema` and forgets to add it here,
    // the form would not send it and the API would fill in a default the user
    // never chose — or, for a required field, the form would look complete while
    // every submission is rejected.
    expect(Object.keys(createPatientFormSchema.shape).sort()).toEqual(
      Object.keys(createPatientSchema.shape).sort(),
    );
  });
});
