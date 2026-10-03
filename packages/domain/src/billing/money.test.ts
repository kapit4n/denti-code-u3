import { describe, expect, it } from 'vitest';

import {
  currencyUsesTwoDecimals,
  formatMinorUnits,
  money,
  percentageOf,
  sumMoney,
} from './money.js';

describe('formatMinorUnits', () => {
  it('renders two-decimal minor units without using floating point', () => {
    expect(formatMinorUnits(0)).toBe('0.00');
    expect(formatMinorUnits(5)).toBe('0.05');
    expect(formatMinorUnits(50)).toBe('0.50');
    expect(formatMinorUnits(100)).toBe('1.00');
    expect(formatMinorUnits(12345)).toBe('123.45');
    expect(formatMinorUnits(100000)).toBe('1000.00');
  });

  it('keeps the sign outside the digits for credits and refunds', () => {
    expect(formatMinorUnits(-1)).toBe('-0.01');
    expect(formatMinorUnits(-12345)).toBe('-123.45');
  });

  it('refuses a fractional amount instead of rounding it silently', () => {
    // Money never exists as a float; accepting one would hide a bug upstream.
    expect(() => formatMinorUnits(10.5)).toThrow(/integer in minor units/);
  });

  it('avoids the classic float error for values toFixed also gets wrong', () => {
    // 1.005.toFixed(2) is "1.00" in IEEE 754. The split here cannot drift.
    expect(formatMinorUnits(1_005)).toBe('10.05');
  });
});

describe('currencyUsesTwoDecimals', () => {
  it('knows which currencies the formatter is valid for', () => {
    expect(currencyUsesTwoDecimals('USD')).toBe(true);
    expect(currencyUsesTwoDecimals('ARS')).toBe(true);
    // JPY has no minor unit; formatting it as two decimals would be off by 100x.
    expect(currencyUsesTwoDecimals('JPY')).toBe(false);
  });
});

describe('percentageOf', () => {
  it('rounds half-up on the cent', () => {
    expect(percentageOf(money(1_005, 'USD'), 21).amountMinor).toBe(211);
    expect(percentageOf(money(100, 'USD'), 21).amountMinor).toBe(21);
  });

  it('refuses a negative rate', () => {
    expect(() => percentageOf(money(100, 'USD'), -1)).toThrow(/non-negative/);
  });
});

describe('sumMoney', () => {
  it('adds in integer minor units', () => {
    const total = sumMoney([money(1_005, 'USD'), money(995, 'USD')], 'USD');
    expect(total.amountMinor).toBe(2_000);
    expect(formatMinorUnits(total.amountMinor)).toBe('20.00');
  });

  it('refuses to mix currencies', () => {
    expect(() => sumMoney([money(100, 'USD'), money(100, 'ARS')], 'USD')).toThrow(/Cannot combine/);
  });
});
