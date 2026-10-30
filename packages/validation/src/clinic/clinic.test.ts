/**
 * The only thing these two schemas decide is whether `?onlyActive` was understood.
 *
 * The behaviour worth pinning is the *refusal*: `?onlyActive=yes` has to fail rather
 * than be read as false, because a caller that sent it believes it has excluded the
 * deactivated records and would be shown all of them.
 */

import { describe, expect, it } from 'vitest';

import {
  chairListQuerySchema,
  dentistListQuerySchema,
  updateClinicSettingsSchema,
} from './index.js';

describe.each([
  ['dentistListQuerySchema', dentistListQuerySchema],
  ['chairListQuerySchema', chairListQuerySchema],
] as const)('%s', (_name, schema) => {
  it('reads the flag when it is sent', () => {
    expect(schema.parse({ onlyActive: 'true' }).onlyActive).toBe(true);
    expect(schema.parse({ onlyActive: 'false' }).onlyActive).toBe(false);
  });

  it('leaves it undefined when it is absent, which means no filter', () => {
    // Not `false`. A missing flag that became `false` would be indistinguishable
    // from `?onlyActive=false`, and the two mean the same thing here only by
    // accident of the repository's truthiness check.
    expect(schema.parse({}).onlyActive).toBeUndefined();
  });

  it('refuses a value it would have to guess at', () => {
    expect(schema.safeParse({ onlyActive: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ onlyActive: '1' }).success).toBe(false);
    expect(schema.safeParse({ onlyActive: '' }).success).toBe(false);
    expect(schema.safeParse({ onlyActive: true }).success).toBe(false);
  });
});

const SETTINGS = {
  name: 'Clinica Central',
  legalName: null,
  taxId: null,
  address: null,
  phone: null,
  email: null,
  timeZone: 'America/Lima',
  currency: 'pen',
  operatingHours: [
    {
      weekday: 1,
      opensAtLocalTime: '08:00',
      closesAtLocalTime: '17:00',
      isClosed: false,
    },
    { weekday: 2, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true },
  ],
};

describe('updateClinicSettingsSchema', () => {
  it('uppercases the currency and accepts a complete week', () => {
    const parsed = updateClinicSettingsSchema.parse(SETTINGS);

    expect(parsed.currency).toBe('PEN');
    expect(parsed.operatingHours).toHaveLength(2);
  });

  it('refuses an unknown IANA time zone', () => {
    expect(
      updateClinicSettingsSchema.safeParse({ ...SETTINGS, timeZone: 'Mars/Olympus_Mons' }).success,
    ).toBe(false);
  });

  it('refuses a currency that is not three letters', () => {
    expect(updateClinicSettingsSchema.safeParse({ ...SETTINGS, currency: 'PESOS' }).success).toBe(
      false,
    );
    expect(updateClinicSettingsSchema.safeParse({ ...SETTINGS, currency: '12' }).success).toBe(
      false,
    );
  });

  it('refuses a day whose closing time is not after its opening time', () => {
    const result = updateClinicSettingsSchema.safeParse({
      ...SETTINGS,
      operatingHours: [
        {
          weekday: 3,
          opensAtLocalTime: '17:00',
          closesAtLocalTime: '08:00',
          isClosed: false,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('accepts a closed day without times', () => {
    const result = updateClinicSettingsSchema.safeParse({
      ...SETTINGS,
      operatingHours: [{ weekday: 4, opensAtLocalTime: '', closesAtLocalTime: '', isClosed: true }],
    });

    expect(result.success).toBe(true);
  });

  it('refuses a weekday listed twice', () => {
    const result = updateClinicSettingsSchema.safeParse({
      ...SETTINGS,
      operatingHours: [
        { weekday: 5, opensAtLocalTime: '08:00', closesAtLocalTime: '12:00', isClosed: false },
        { weekday: 5, opensAtLocalTime: '13:00', closesAtLocalTime: '17:00', isClosed: false },
      ],
    });

    expect(result.success).toBe(false);
  });
});
