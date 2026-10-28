/**
 * How a payment's money is shown and typed.
 *
 * The amounts a person sees and types are **major units** ("120.00"), the amounts
 * everywhere else are **integer minor units**, and this file is the seam between the
 * two alongside `charge-presentation.ts` — the only seams, so a cent cannot be
 * gained or lost in a screen. The parsing of a typed box lives in the charges file
 * and is imported here rather than copied, because "120.50" means the same thing in
 * a price box and a payment box.
 *
 * **The register only ever sums money the server recorded.** The paid total is the
 * domain's own `sumMoney` over the payments, priced in one currency (the charges'
 * — the currency the clinic prices every bill in), and it refuses to add across a
 * mismatch rather than inventing a total that is not expressed in anything. "Still
 * to pay" is the difference between the bill the charges section draws and that
 * paid total: simple integer subtraction, because both halves are already cents.
 */

import { sumMoney, type Payment, type PaymentMethod } from '@denti-code-u3/domain';
import type { CurrencyCode } from '@denti-code-u3/types';

import type { Translate, TranslationKey } from '../../i18n/index.js';

const PAYMENT_METHOD_KEY: Readonly<Record<PaymentMethod, TranslationKey>> = {
  CASH: 'visits.paymentMethod.CASH',
  CARD: 'visits.paymentMethod.CARD',
  TRANSFER: 'visits.paymentMethod.TRANSFER',
  YAPE: 'visits.paymentMethod.YAPE',
  PLIN: 'visits.paymentMethod.PLIN',
  OTHER: 'visits.paymentMethod.OTHER',
};

export function paymentMethodLabel(t: Translate, method: PaymentMethod): string {
  return t(PAYMENT_METHOD_KEY[method]);
}

/** The picker's choices, in the domain's order. */
export function paymentMethodOptions(t: Translate): readonly {
  readonly method: PaymentMethod;
  readonly label: string;
}[] {
  return (Object.keys(PAYMENT_METHOD_KEY) as PaymentMethod[]).map((method) => ({
    method,
    label: paymentMethodLabel(t, method),
  }));
}

/**
 * What the register has recorded so far, in one currency.
 *
 * The payments each carry their own currency (the clinic's); `sumMoney` refuses to
 * add across a mismatch rather than inventing a total that is not expressed in
 * anything, so the caller names the currency the bill is in — the charges'.
 */
export function paymentsTotal(payments: readonly Payment[], currency: CurrencyCode): number {
  return sumMoney(
    payments.map((payment) => ({ amountMinor: payment.amountMinor, currency: payment.currency })),
    currency,
  ).amountMinor;
}

/**
 * What the bill is still owed, in minor units.
 *
 * Two integer halves: the billed total from the charges section and the paid total
 * from this file. Never negative — a visit cannot owe less than nothing — so the
 * screen that quotes it can trust it to mean what it says.
 */
export function stillToPayMinor(billedMinor: number, paidMinor: number): number {
  return Math.max(0, billedMinor - paidMinor);
}
