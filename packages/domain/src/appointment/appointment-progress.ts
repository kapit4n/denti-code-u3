import type { IsoDateTime } from '@denti-code-u3/types';

import type { AppointmentStatus } from './appointment-status.js';

/**
 * One step in an appointment's recorded progress.
 *
 * `occurredAt` is when the move happened in the clinic, which is not necessarily
 * when the row was written: reception can check a patient in after writing it down
 * on paper. `fromStatus` is null only for a step whose starting point is not known.
 */
export interface AppointmentProgressEntry {
  readonly fromStatus: AppointmentStatus | null;
  readonly toStatus: AppointmentStatus;
  readonly occurredAt: IsoDateTime;
  readonly reason: string | null;
}
