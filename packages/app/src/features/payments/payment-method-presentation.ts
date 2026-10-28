/**
 * How the ledger names a payment method.
 *
 * The values are the domain's closed enum; the labels are this feature's copy so a
 * payment screen and a visit's register can change their wording independently. The
 * map is typed against `PaymentMethod`, so adding a method to the domain fails
 * typecheck here rather than rendering an untranslated value.
 */

import type { PaymentMethod } from '@denti-code-u3/domain';

import type { Translate, TranslationKey } from '../../i18n/index.js';

const PAYMENT_METHOD_KEY: Readonly<Record<PaymentMethod, TranslationKey>> = {
  CASH: 'payments.method.CASH',
  CARD: 'payments.method.CARD',
  TRANSFER: 'payments.method.TRANSFER',
  YAPE: 'payments.method.YAPE',
  PLIN: 'payments.method.PLIN',
  OTHER: 'payments.method.OTHER',
};

export function paymentMethodLabel(t: Translate, method: PaymentMethod): string {
  return t(PAYMENT_METHOD_KEY[method]);
}

export function paymentMethodOptions(
  t: Translate,
): readonly { readonly value: PaymentMethod; readonly label: string }[] {
  return (Object.keys(PAYMENT_METHOD_KEY) as PaymentMethod[]).map((value) => ({
    value,
    label: paymentMethodLabel(t, value),
  }));
}
