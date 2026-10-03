/**
 * Patient editing rules.
 *
 * The fake is a hand-written recorder rather than a mock: `update` is the only
 * call `updatePatient` makes, so recording what it was handed says more than a
 * call count would, and keeps this file free of a database.
 */

import { describe, expect, it } from 'vitest';

import type { ClinicId, IsoDate, PatientId } from '@denti-code-u3/types';
import { updatePatient, type EditablePatientDetails } from './index.js';
import type { PatientWriteRepository } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import type { Clock } from '../shared/clock.js';

const CLINIC = '11111111-1111-4111-8111-111111111111' as ClinicId;
const OTHER_CLINIC = '22222222-2222-4222-8222-222222222222' as ClinicId;
const PATIENT = '33333333-3333-4333-8333-333333333333' as PatientId;

function fixedClock(today: string): Clock {
  return { now: () => `${today}T12:00:00.000Z` as never };
}

interface FakeRepository extends PatientWriteRepository {
  readonly updates: {
    readonly clinicId: string;
    readonly patientId: string;
    readonly details: EditablePatientDetails;
  }[];
  /** What the fake reports back. `false` models "no such patient in this clinic". */
  found: boolean;
}

function fakeRepository(found = true): FakeRepository {
  const updates: FakeRepository['updates'] = [];
  return {
    updates,
    found,
    async register() {
      throw new Error('registration is not what these tests are about');
    },
    async update(clinicId, patientId, details) {
      updates.push({ clinicId, patientId, details });
      return this.found;
    },
  };
}

function completeInput() {
  return {
    firstName: 'Ana',
    lastName: 'García',
    preferredName: 'Ana María',
    identificationNumber: 'CC-1-2-3',
    phone: '+57 300 000 0000',
    email: 'ana@example.test',
    birthDate: '1990-04-17' as IsoDate,
  };
}

describe('updatePatient', () => {
  it('writes the trimmed details against the clinic and patient it was given', async () => {
    const patients = fakeRepository();

    const found = await updatePatient(
      CLINIC,
      PATIENT,
      { ...completeInput(), firstName: '  Ana  ', lastName: ' García ' },
      { patients, clock: fixedClock('2026-10-03') },
    );

    expect(found).toBe(true);
    expect(patients.updates).toEqual([
      {
        clinicId: CLINIC,
        patientId: PATIENT,
        details: {
          firstName: 'Ana',
          lastName: 'García',
          preferredName: 'Ana María',
          identificationNumber: 'CC-1-2-3',
          phone: '+57 300 000 0000',
          email: 'ana@example.test',
          birthDate: '1990-04-17',
        },
      },
    ]);
  });

  it('passes the clinic scope to the repository rather than checking it itself', async () => {
    // The scope belongs in the `WHERE` clause. If the use case looked the patient
    // up first and then wrote to it by id, the two steps could disagree — which is
    // the shape of a cross-tenant write (ADR 0014).
    const patients = fakeRepository();

    await updatePatient(OTHER_CLINIC, PATIENT, completeInput(), {
      patients,
      clock: fixedClock('2026-10-03'),
    });

    expect(patients.updates[0]?.clinicId).toBe(OTHER_CLINIC);
  });

  it('reports a patient the clinic does not hold', async () => {
    const patients = fakeRepository(false);

    const found = await updatePatient(CLINIC, PATIENT, completeInput(), {
      patients,
      clock: fixedClock('2026-10-03'),
    });

    // False rather than an exception: "not in this clinic" and "not anywhere" are
    // the same answer, and the caller should not be able to tell them apart.
    expect(found).toBe(false);
  });

  it('drops optional fields that were left blank, so they can be cleared', async () => {
    const patients = fakeRepository();

    await updatePatient(
      CLINIC,
      PATIENT,
      { firstName: 'Ana', lastName: 'García', email: '   ' },
      { patients, clock: fixedClock('2026-10-03') },
    );

    // Absent means "does not have one". A merge that ignored this would leave the
    // old email on a record whose email was just corrected away.
    expect(patients.updates[0]?.details.email).toBeUndefined();
    expect(patients.updates[0]?.details.preferredName).toBeUndefined();
  });

  it.each([
    ['firstName', '   '],
    ['lastName', ''],
  ])('rejects a blank %s without writing anything', async (field, value) => {
    const patients = fakeRepository();

    await expect(
      updatePatient(
        CLINIC,
        PATIENT,
        { ...completeInput(), [field]: value },
        {
          patients,
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    expect(patients.updates).toHaveLength(0);
  });

  it('rejects a birth date that has not happened yet', async () => {
    const patients = fakeRepository();

    await expect(
      updatePatient(
        CLINIC,
        PATIENT,
        { ...completeInput(), birthDate: '2027-01-01' },
        {
          patients,
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Checked before the write, so a rejected edit leaves the record as it was.
    expect(patients.updates).toHaveLength(0);
  });

  it('rejects an impossible birth date', async () => {
    const patients = fakeRepository();

    await expect(
      updatePatient(
        CLINIC,
        PATIENT,
        { ...completeInput(), birthDate: '1990-02-30' },
        {
          patients,
          clock: fixedClock('2026-10-03'),
        },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    expect(patients.updates).toHaveLength(0);
  });

  it('cannot be used to change anything outside the editable fields', async () => {
    const patients = fakeRepository();

    // `EditablePatientDetails` has no record number, active flag or anonymisation
    // timestamp, so there is nothing to pass even if a caller tried. Compile-time
    // protection, which is the point of the narrow type.
    await updatePatient(
      CLINIC,
      PATIENT,
      { ...completeInput(), recordNumber: 'P-999999' } as never,
      { patients, clock: fixedClock('2026-10-03') },
    );

    expect(patients.updates[0]?.details).not.toHaveProperty('recordNumber');
  });
});
