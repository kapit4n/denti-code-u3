/**
 * Money rules for the dental clinic.
 *
 * Every amount is an integer in the currency's minor unit (cents). Floating
 * point is never used: `0.1 + 0.2` must never decide what a patient owes.
 * Rounding is half-up on the cent, applied once, at the point where a discount
 * or tax turns a percentage into an amount.
 */

import type { CurrencyCode } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

export interface MoneyAmount {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): MoneyAmount {
  if (!Number.isInteger(amountMinor)) {
    throw new DomainError(
      'INVALID_INPUT',
      `Money must be an integer in minor units, received ${amountMinor}`,
      { amountMinor },
    );
  }
  return { amountMinor, currency };
}

export function addMoney(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(amounts: readonly MoneyAmount[], currency: CurrencyCode): MoneyAmount {
  return money(
    amounts.reduce((total, amount) => {
      assertSameCurrency(amount, money(0, currency));
      return total + amount.amountMinor;
    }, 0),
    currency,
  );
}

/**
 * Apply a percentage rate (e.g. `21` for 21%) to an amount, rounding half-up to
 * the nearest cent.
 */
export function percentageOf(amount: MoneyAmount, ratePercent: number): MoneyAmount {
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    throw new DomainError('INVALID_INPUT', 'A rate must be a non-negative number', { ratePercent });
  }
  const raw = (amount.amountMinor * ratePercent) / 100;
  return money(Math.round(raw), amount.currency);
}

function assertSameCurrency(a: MoneyAmount, b: MoneyAmount): void {
  if (a.currency !== b.currency) {
    throw new DomainError('INVALID_INPUT', `Cannot combine ${a.currency} with ${b.currency}`, {
      left: a.currency,
      right: b.currency,
    });
  }
}
