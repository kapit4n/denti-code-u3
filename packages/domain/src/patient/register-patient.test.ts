/**
 * Patient registration rules.
 *
 * The repository is a hand-written fake rather than a mock: `save` and
 * `nextRecordNumber` are the only two calls this use case makes, so recording
 * them is clearer than asserting on call counts, and it keeps the test free of
 * any database.
 */

import { describe, expect, it } from 'vitest';

import type { ClinicId, IsoDateTime } from '@denti-code-u3/types';
import {
  assertPlausibleBirthDate,
  nextPatientRecordNumber,
  registerPatient,
  type Patient,
} from './index.js';
import type { PatientWriteRepository } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/id-generator.js';

const CLINIC = '11111111-1111-4111-8111-111111111111' as ClinicId;

function fixedClock(today: string): Clock {
  return { now: () => `${today}T12:00:00.000Z` as IsoDateTime };
}

/** Yields predictable ids so assertions can name them. */
function sequentialIds(): IdGenerator {
  let counter = 0;
  return { nextId: () => `patient-${++counter}` };
}

interface FakeRepository extends PatientWriteRepository {
  readonly saved: { patient: Patient; recordNumber?: string }[];
  issued: string[];
}

function fakeRepository(issued: string[] = ['P-000001', 'P-000002']): FakeRepository {
  const saved: { patient: Patient; recordNumber?: string }[] = [];
  return {
    saved,
    issued,
    async register(patient) {
      const recordNumber = nextPatientRecordNumber(this.issued);
      this.issued.push(recordNumber);
      saved.push({ patient, recordNumber });
      return { recordNumber };
    },
    // Registration is what this file is about; `updatePatient` has its own.
    async update() {
      throw new Error('not used by these tests');
    },
  };
}

function minimalInput() {
  return { firstName: 'Ana', lastName: 'García' };
}

describe('registerPatient', () => {
  it('stores the patient, active, in the requesting clinic', async () => {
    const patients = fakeRepository();

    const { patient } = await registerPatient(CLINIC, minimalInput(), {
      patients,
      ids: sequentialIds(),
      clock: fixedClock('2026-10-03'),
    });

    expect(patient).toMatchObject({
      id: 'patient-1',
      clinicId: CLINIC,
      firstName: 'Ana',
      lastName: 'García',
      isActive: true,
    });
    expect(patients.saved).toHaveLength(1);
  });

  it('assigns the next record number for the clinic', async () => {
    const patients = fakeRepository(['P-000001', 'P-000002']);

    const { recordNumber } = await registerPatient(CLINIC, minimalInput(), {
      patients,
      ids: sequentialIds(),
      clock: fixedClock('2026-10-03'),
    });

    expect(recordNumber).toBe('P-000003');
    expect(patients.saved[0]?.recordNumber).toBe('P-000003');
  });

  it('issues P-000001 to the first patient of a clinic', async () => {
    const patients = fakeRepository([]);

    const { recordNumber } = await registerPatient(CLINIC, minimalInput(), {
      patients,
      ids: sequentialIds(),
      clock: fixedClock('2026-10-03'),
    });

    expect(recordNumber).toBe('P-000001');
  });

  it('trims names and drops optional fields that were only whitespace', async () => {
    const patients = fakeRepository();

    const { patient } = await registerPatient(
      CLINIC,
      {
        firstName: '  Ana  ',
        lastName: '  García ',
        preferredName: '   ',
        email: '',
      },
      { patients, ids: sequentialIds(), clock: fixedClock('2026-10-03') },
    );

    expect(patient.firstName).toBe('Ana');
    expect(patient.lastName).toBe('García');
    // An empty string is not the same as "not supplied": storing '' would render
    // as a blank line in the profile and fail a `?length > 0` check downstream.
    expect(patient.preferredName).toBeUndefined();
    expect(patient.email).toBeUndefined();
  });

  it.each([
    ['firstName', '   '],
    ['lastName', ''],
  ])('rejects a blank %s rather than storing it', async (field, value) => {
    const patients = fakeRepository();

    await expect(
      registerPatient(
        CLINIC,
        { ...minimalInput(), [field]: value },
        {
          patients,
          ids: sequentialIds(),
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    // Nothing written: a rejected registration must not leave a row behind.
    expect(patients.saved).toHaveLength(0);
  });

  it('rejects a birth date that has not happened yet', async () => {
    const patients = fakeRepository();

    await expect(
      registerPatient(
        CLINIC,
        { ...minimalInput(), birthDate: '2026-12-01' },
        {
          patients,
          ids: sequentialIds(),
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(patients.saved).toHaveLength(0);
  });

  it('accepts a birth date of today, which has happened', async () => {
    const patients = fakeRepository();

    const { patient } = await registerPatient(
      CLINIC,
      { ...minimalInput(), birthDate: '2026-10-03' },
      { patients, ids: sequentialIds(), clock: fixedClock('2026-10-03') },
    );

    expect(patient.birthDate).toBe('2026-10-03');
  });

  it('rejects an impossible calendar date', async () => {
    const patients = fakeRepository();

    await expect(
      registerPatient(
        CLINIC,
        { ...minimalInput(), birthDate: '2026-02-30' },
        {
          patients,
          ids: sequentialIds(),
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('accepts a 29 February in a leap year and rejects it otherwise', () => {
    expect(() => assertPlausibleBirthDate('2024-02-29', '2026-10-03')).not.toThrow();
    expect(() => assertPlausibleBirthDate('2026-02-29', '2026-10-03')).toThrow(DomainError);
  });

  it('does not consume a record number when validation fails first', async () => {
    const patients = fakeRepository();

    await expect(
      registerPatient(
        CLINIC,
        { firstName: '', lastName: 'García' },
        {
          patients,
          ids: sequentialIds(),
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    // `nextRecordNumber` is only reached after validation, so a rejected form
    // cannot punch a hole in the sequence.
    expect(patients.saved).toHaveLength(0);
  });
});

describe('nextPatientRecordNumber', () => {
  it.each([
    [[], 'P-000001'],
    [['P-000001'], 'P-000002'],
    [['P-000001', 'P-000002', 'P-000010'], 'P-000011'],
    // Past a million patients the number simply grows: padding is a minimum
    // width, not a fixed one, so nothing is ever truncated back into a collision.
    [['P-999999'], 'P-1000000'],
  ])('issues %j -> %s', (issued, expected) => {
    expect(nextPatientRecordNumber(issued)).toBe(expected);
  });

  it('ignores numbers it does not recognise rather than failing', () => {
    // A clinic that imported data from another system may hold legacy numbers.
    // One odd value must not stop every future registration.
    expect(nextPatientRecordNumber(['MANUAL-1', 'P-000004'])).toBe('P-000005');
  });
});
