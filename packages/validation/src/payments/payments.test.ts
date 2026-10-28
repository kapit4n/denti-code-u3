import { describe, expect, it } from 'vitest';

import { paymentLedgerQuerySchema } from './index.js';

describe('paymentLedgerQuerySchema', () => {
  it('accepts an inclusive date period and an optional method', () => {
    expect(
      paymentLedgerQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-31',
        method: 'CARD',
      }).success,
    ).toBe(true);
    expect(
      paymentLedgerQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success,
    ).toBe(true);
  });

  it('refuses a period whose end is before its start', () => {
    const result = paymentLedgerQuerySchema.safeParse({
      from: '2026-10-31',
      to: '2026-10-01',
    });

    expect(result.success).toBe(false);
  });

  it('refuses an unknown payment method', () => {
    expect(
      paymentLedgerQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-31',
        method: 'CHEQUE',
      }).success,
    ).toBe(false);
  });
});
