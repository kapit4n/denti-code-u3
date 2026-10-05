/**
 * The agenda read model.
 *
 * One row of the clinic's book, as the calendar and the day's list both need it.
 * It is a *read model* rather than the `Appointment` entity for three reasons:
 *
 *  - it names the patient and the dentist, because a calendar entry that renders
 *    as an id is not a calendar;
 *  - it carries `endsAt`, so no client recomputes a duration in its own timezone
 *    and disagrees with the block drawn next to it;
 *  - it is one named shape instead of a row plus a join the UI has to know about.
 *
 * `endsAt` is computed here for the same reason it is not stored (ADR 0012): a
 * stored end time can disagree with a changed start or duration, and the agenda
 * would then show two truths.
 */

import type {
  AppointmentId,
  ChairId,
  ClinicId,
  DentistId,
  IsoDateTime,
  PatientId,
} from '@denti-code-u3/types';
import type { AppointmentStatus } from './appointment-status.js';

export interface AgendaEntry {
  readonly id: AppointmentId;
  readonly clinicId: ClinicId;
  readonly patientId: PatientId;
  readonly patientFirstName: string;
  readonly patientLastName: string;
  /** Null once the dentist leaves the clinic: the column is `on delete set null`. */
  readonly dentistId: DentistId | null;
  readonly dentistFullName: string | null;
  readonly chairId: ChairId | null;
  readonly chairName: string | null;
  /** Instant the appointment begins, stored in UTC. */
  readonly startsAt: IsoDateTime;
  /** Computed from `startsAt` + `durationMinutes`. Never stored. */
  readonly endsAt: IsoDateTime;
  readonly durationMinutes: number;
  readonly status: AppointmentStatus;
  readonly notes: string | null;
}

/**
 * The window to read.
 *
 * Half-open `[from, to)`, which is what lets two appointments touch: a
 * 09:00–09:30 and a 09:30–10:00 booking are not an overlap, and a closed
 * interval would call them one. It is also the interval the database's exclusion
 * constraints use, so "what the agenda shows" and "what the database refuses"
 * are the same question.
 *
 * An appointment is in the window when the two intervals **overlap** — it need
 * not start inside it. A 23:30 booking that runs past midnight belongs on both
 * days' agendas, and filtering on `starts_at >= from` would drop it from the
 * second one.
 *
 * The window is bounded by the caller: a year is plenty, and a clinic has
 * decades of appointments and no reason to load them.
 *
 * This is the bare interval. `AgendaWindow` adds the optional dentist and chair
 * filters on top of it, because a screen may narrow what it shows while the
 * conflict check — which is about a specific dentist and chair, and must see
 * *every* booking to be correct — may not narrow anything. The one thing the
 * checker must not do is filter by the resources it is about to collide with.
 */
export interface AppointmentWindow {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
}

export interface AgendaWindow extends AppointmentWindow {
  /** Restrict to these dentists. Empty or absent means every dentist. */
  readonly dentistIds?: readonly DentistId[];
  /** Restrict to these chairs. Empty or absent means every chair. */
  readonly chairIds?: readonly ChairId[];
}
