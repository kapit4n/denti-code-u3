import { describe, expect, it } from 'vitest';
import {
  createPatientFormSchema,
  createPatientSchema,
  searchPatientsQuerySchema,
  updatePatientSchema,
} from './index.js';

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
  it('accepts an edit that changed only a phone number', () => {
    const result = updatePatientSchema.safeParse({
      firstName: 'Ana',
      lastName: 'Gómez',
      phone: '+54 9 11 5555 1234',
    });

    expect(result.success).toBe(true);
  });

  it('requires the names, because an edit replaces the editable set', () => {
    expect(updatePatientSchema.safeParse({}).success).toBe(false);
    expect(updatePatientSchema.safeParse({ firstName: 'Ana' }).success).toBe(false);
  });

  it('silently drops isActive rather than applying it', () => {
    // Deactivating is a separate, deliberate action, so the flag must not ride in
    // on an edit. A Zod object strips unknown keys instead of rejecting them,
    // which is the right behaviour for a boundary: an extra field from a newer
    // client should not fail an otherwise valid request. What matters is that it
    // is dropped, which is asserted here and again at the storage layer — a
    // stripped field that reached the database would deactivate a patient because
    // someone opened the form to fix a surname.
    const result = updatePatientSchema.parse({
      firstName: 'Ana',
      lastName: 'Gómez',
      isActive: false,
    });

    expect(result).not.toHaveProperty('isActive');
  });

  it('silently drops a record number, which the server owns', () => {
    // ADR 0015: the chart number is assigned per clinic and may not be chosen.
    const result = updatePatientSchema.parse({
      firstName: 'Ana',
      lastName: 'Gómez',
      recordNumber: 'P-999999',
    });

    expect(result).not.toHaveProperty('recordNumber');
  });

  it('covers the same fields as the create body', () => {
    expect(Object.keys(updatePatientSchema.shape).sort()).toEqual(
      Object.keys(createPatientSchema.shape).sort(),
    );
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
