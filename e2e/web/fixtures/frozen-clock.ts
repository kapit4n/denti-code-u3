/**
 * The suite's clock: one fixed instant, installed before every page loads.
 *
 * Every fixture in this layer is a capture of one particular Monday — the agenda's
 * appointments sit on 2026-10-05, the booking spec's expected instant is that day's
 * 10:00 in Lima, and the profile's history stops in September. The page, meanwhile,
 * opens the agenda on *today*, so nothing about the application was wrong: the specs
 * were a photograph of a day that had moved. On 2026-10-07 fourteen of them failed
 * with an empty grid under a heading reading "October 7, 2026", and the same fourteen
 * failed on a clean checkout — the drift was in the harness, not the code.
 *
 * Freezing here is the choice over the alternative (computing every fixture date from
 * `new Date()`), and the argument for it is the fixtures' own design: they were
 * captured from a running API and frozen on purpose, because a spec that drifts with
 * the seed and the calendar is asserting nothing about itself. A captured instant the
 * page cannot disagree with keeps that property. Recorded in `docs/progress/STATE.md`
 * under the session that made it.
 *
 * **The instant is Monday 2026-10-05 08:00 in the clinic** (13:00Z): the day the
 * fixtures describe, early enough that the 10:00 lane the booking specs click is
 * still ahead of it, and inside the clinic's opening hours. It is the same wall-clock
 * moment in every zone a run can find itself in (La Paz, New York, UTC), so "today"
 * resolves to October 5 wherever the browser or the machine sits.
 *
 * Only `Date` is fixed; timers are not, so debounces, query retries and
 * `waitForResponse` behave exactly as before. That is what makes this a fixture
 * rather than a rewrite: `page.clock.setFixedTime` answers `new Date()` and
 * `Date.now()` with one value and leaves the rest of the runtime alone.
 *
 * Import `test` from here rather than from `@playwright/test` — that single line is
 * what puts the page on this clock. `expect` is re-exported so a spec needs only one
 * import.
 */

import { expect, test as base } from '@playwright/test';

export { expect };

/** Monday 2026-10-05 08:00 in the clinic — the day every fixture here describes. */
export const FROZEN_NOW = '2026-10-05T13:00:00.000Z';

export const test = base.extend({
  page: async ({ page }, use) => {
    // Before the first navigation: the clock is read on load (the agenda's "today"),
    // so installing it after `goto` would let one frame through at the real date.
    await page.clock.setFixedTime(FROZEN_NOW);
    await use(page);
  },
});
