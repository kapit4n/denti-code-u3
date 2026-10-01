import { describe, expect, it } from 'vitest';
import {
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
