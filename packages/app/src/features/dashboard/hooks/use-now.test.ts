import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COUNTDOWN_TICK_MS, useNow } from './use-now.js';

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves the clock forward on the countdown tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T13:00:00.000Z'));

    const { result } = renderHook(() => useNow());

    expect(result.current).toBe(Date.parse('2026-10-05T13:00:00.000Z'));

    act(() => {
      vi.advanceTimersByTime(COUNTDOWN_TICK_MS);
    });

    expect(result.current).toBe(Date.parse('2026-10-05T13:00:15.000Z'));
  });
});
