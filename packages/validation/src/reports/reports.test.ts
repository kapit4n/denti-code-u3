import { describe, expect, it } from 'vitest';

import { reportRangeQuerySchema } from './index.js';

describe('reportRangeQuerySchema', () => {
  it('accepts an inclusive date range and an optional dentist', () => {
    const result = reportRangeQuerySchema.safeParse({
      from: '2026-10-01',
      to: '2026-10-31',
      dentistId: '11111111-2222-4333-8444-000000000001',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a single-day report', () => {
    expect(reportRangeQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-05' }).success).toBe(
      true,
    );
  });

  it('refuses a range that ends before it starts', () => {
    const result = reportRangeQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['to']);
    }
  });

  it('refuses an instant where a clinic date belongs', () => {
    expect(
      reportRangeQuerySchema.safeParse({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31',
      }).success,
    ).toBe(false);
  });

  it('refuses a dentist id that is not a uuid', () => {
    expect(
      reportRangeQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-31',
        dentistId: 'Dra. Rivera',
      }).success,
    ).toBe(false);
  });
});
