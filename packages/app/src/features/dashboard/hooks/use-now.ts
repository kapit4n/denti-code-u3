/**
 * A clock the dashboard can render from.
 *
 * The appointment countdown is the one thing on the dashboard that changes without a
 * server answer. One interval in the card, rather than one per row, keeps every badge
 * on the same tick and cleans up with the component.
 *
 * Fifteen seconds is faster than the minute the badge displays: a start that is 2 min
 * 10 s away should become "in 2 min" before a whole minute passes, and "now" should
 * not lag behind the clock by up to 59 seconds.
 */

import { useEffect, useState } from 'react';

export const COUNTDOWN_TICK_MS = 15_000;

export function useNow(intervalMs = COUNTDOWN_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
