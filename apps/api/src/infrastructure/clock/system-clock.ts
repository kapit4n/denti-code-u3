import type { Clock } from '@denti-code-u3/domain';
import type { IsoDateTime } from '@denti-code-u3/types';

/** The real clock. Tests inject a fixed `Clock` instead. */
export const systemClock: Clock = {
  now(): IsoDateTime {
    return new Date().toISOString();
  },
};
