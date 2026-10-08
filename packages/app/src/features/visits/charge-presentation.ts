/**
 * How a charge's money is shown and typed.
 *
 * The amounts a person sees and types are **major units** ("120.00"), the amounts
 * everywhere else are **integer minor units**, and this file is the seam between
 * the two — the only seam, so a cent cannot be gained or lost in a screen.
 *
 *  - Reading: the line total of a charge is the domain's own
 *    `calculateChargeTotal` (quantity × unit price, minus discount, plus tax),
 *    priced in the charge's own currency. The screen never re-derives it, because
 *    a total drawn a second way is a total that can disagree with the record.
 *  - Typing: a box of major units is parsed here with integer arithmetic —
 *    split the digits, never multiply a decimal by 100 — the same discipline the
 *    domain's `formatMinorUnits` keeps in the other direction.
 */

import {
  calculateChargeTotal,
  sumMoney,
  type Charge,
  type MoneyAmount,
} from '@denti-code-u3/domain';
import type { CurrencyCode } from '@denti-code-u3/types';

/** What one charge is worth, after its discount and tax. */
export function chargeLineTotal(charge: Charge): MoneyAmount {
  return calculateChargeTotal(charge);
}

/**
 * What the bill is worth so far, in one currency.
 *
 * The currency is the charges' own, so `sumMoney` refuses to add across a mismatch
 * rather than inventing a total that is not expressed in anything.
 */
export function chargesTotal(charges: readonly Charge[], currency: CurrencyCode): number {
  return sumMoney(charges.map(calculateChargeTotal), currency).amountMinor;
}

/**
 * "120" or "120.50" → `12000` / `12050` minor units.
 *
 * Returns `undefined` for anything a person was still typing — a blank box, a
 * stray sign, three decimal places — so the box can be left unpriceable until it
 * parses. A price of zero is parseable but never sendable: it is refused by the
 * boundary schema, not invented here.
 */
export function parseMajorUnitsToMinor(value: string): number | undefined {
  const trimmed = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return undefined;
  }

  const [units, cents = ''] = trimmed.split('.');
  return Number(units) * 100 + Number(cents.padEnd(2, '0'));
}
