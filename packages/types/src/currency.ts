/**
 * Money is always an integer amount of the currency's minor unit (e.g. cents).
 *
 * Floating point is never used for money anywhere in Denti-Code U3: `10.10` is
 * stored and computed as `1010`.
 */
export type Money = number & { readonly __moneyBrand?: unique symbol };

export type CurrencyCode = string;

export interface MoneyAmount {
  /** Integer amount in the currency's minor unit. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): MoneyAmount {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(`Money must be an integer in minor units, received ${amountMinor}`);
  }
  return { amountMinor, currency };
}
