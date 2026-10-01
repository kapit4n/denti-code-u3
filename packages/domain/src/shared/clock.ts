import type { IsoDateTime } from '@denti-code-u3/types';

/**
 * The domain never reads the ambient clock. Time is a dependency, so that
 * scheduling rules, ageing and audit stamps are deterministically testable.
 */
export interface Clock {
  /** Current instant, as an ISO-8601 UTC string. */
  now(): IsoDateTime;
}
