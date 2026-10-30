import { describe, expect, it } from 'vitest';

import type { ClinicRepository } from '../ports/index.js';
import type { Clinic, ClinicOperatingHours, ClinicSettingsUpdate } from './clinic.js';
import { updateClinicSettings, type UpdateClinicSettingsInput } from './update-clinic-settings.js';

const CLINIC_ID = 'clinic-1' as never;

const OPEN_HOURS: ClinicOperatingHours = {
  weekday: 1,
  opensAtLocalTime: '08:00',
  closesAtLocalTime: '17:00',
  isClosed: false,
};

function aClinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    id: CLINIC_ID,
    name: 'Clinica',
    timeZone: 'America/Lima',
    currency: 'PEN',
    operatingHours: [OPEN_HOURS],
    settings: {},
    ...overrides,
  };
}

function validInput(overrides: Partial<UpdateClinicSettingsInput> = {}): UpdateClinicSettingsInput {
  return {
    name: '  Clinica Central  ',
    legalName: '  Clinica Central S.A.  ',
    taxId: null,
    address: null,
    phone: null,
    email: null,
    timeZone: 'America/Lima',
    currency: 'pen',
    operatingHours: [
      {
        weekday: 2,
        opensAtLocalTime: '09:00',
        closesAtLocalTime: '18:00',
        isClosed: false,
      },
      {
        weekday: 1,
        opensAtLocalTime: '00:00',
        closesAtLocalTime: '00:00',
        isClosed: true,
      },
    ],
    ...overrides,
  };
}

function harness(result: 'saved' | 'missing' = 'saved') {
  let received: ClinicSettingsUpdate | undefined;

  const clinics: ClinicRepository = {
    findById: async () => aClinic(),
    getDefault: async () => aClinic(),
    updateSettings: async (_clinicId, settings) => {
      received = settings;
      return result === 'missing'
        ? undefined
        : aClinic({
            name: settings.name,
            legalName: settings.legalName ?? undefined,
            timeZone: settings.timeZone,
            currency: settings.currency,
            operatingHours: settings.operatingHours,
          });
    },
  };

  return {
    dependencies: { clinics },
    received: () => received,
  };
}

describe('updateClinicSettings', () => {
  it('trims the text, uppercases the currency and clears closed days', async () => {
    const fake = harness();

    const clinic = await updateClinicSettings(CLINIC_ID, validInput(), fake.dependencies);

    expect(fake.received()).toMatchObject({
      name: 'Clinica Central',
      legalName: 'Clinica Central S.A.',
      currency: 'PEN',
      timeZone: 'America/Lima',
    });
    expect(fake.received()?.operatingHours).toEqual([
      { weekday: 1, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true },
      { weekday: 2, opensAtLocalTime: '09:00', closesAtLocalTime: '18:00', isClosed: false },
    ]);
    expect(clinic.name).toBe('Clinica Central');
  });

  it('blank optional fields become null rather than empty strings', async () => {
    const fake = harness();

    await updateClinicSettings(
      CLINIC_ID,
      validInput({ legalName: '   ', taxId: '', address: null, phone: undefined, email: '' }),
      fake.dependencies,
    );

    expect(fake.received()).toMatchObject({
      legalName: null,
      taxId: null,
      address: null,
      phone: null,
      email: null,
    });
  });

  it('refuses a name that is only whitespace', async () => {
    const fake = harness();

    await expect(
      updateClinicSettings(CLINIC_ID, validInput({ name: '   ' }), fake.dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fake.received()).toBeUndefined();
  });

  it('refuses an unknown time zone before touching the repository', async () => {
    const fake = harness();

    await expect(
      updateClinicSettings(
        CLINIC_ID,
        validInput({ timeZone: 'Mars/Olympus_Mons' }),
        fake.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fake.received()).toBeUndefined();
  });

  it('refuses a currency that is not three ISO letters', async () => {
    const fake = harness();

    await expect(
      updateClinicSettings(CLINIC_ID, validInput({ currency: 'PESOS' }), fake.dependencies),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fake.received()).toBeUndefined();
  });

  it('refuses a weekday listed twice', async () => {
    const fake = harness();

    await expect(
      updateClinicSettings(
        CLINIC_ID,
        validInput({
          operatingHours: [
            OPEN_HOURS,
            { ...OPEN_HOURS, opensAtLocalTime: '10:00', closesAtLocalTime: '12:00' },
          ],
        }),
        fake.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses a day whose closing time is not after its opening time', async () => {
    const fake = harness();

    await expect(
      updateClinicSettings(
        CLINIC_ID,
        validInput({
          operatingHours: [
            {
              weekday: 3,
              opensAtLocalTime: '17:00',
              closesAtLocalTime: '08:00',
              isClosed: false,
            },
          ],
        }),
        fake.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses hours that are not written as HH:MM', async () => {
    const fake = harness();

    await expect(
      updateClinicSettings(
        CLINIC_ID,
        validInput({
          operatingHours: [
            {
              weekday: 3,
              opensAtLocalTime: '8:00',
              closesAtLocalTime: '17:00',
              isClosed: false,
            },
          ],
        }),
        fake.dependencies,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('answers NOT_FOUND when the repository cannot find the clinic', async () => {
    const fake = harness('missing');

    await expect(
      updateClinicSettings(CLINIC_ID, validInput(), fake.dependencies),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
