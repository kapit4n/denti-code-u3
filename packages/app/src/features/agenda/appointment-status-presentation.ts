/**
 * How an appointment status is shown, and what moving to it is called.
 *
 * Two vocabularies, deliberately not one. A *state* is named for the record
 * ("Arrived", "No-show") because that is what the panel and the grid are reporting; a
 * *transition* is named for the act ("Check in", "Put back to scheduled") because
 * that is what the button promises to do. One table tried to serve both, and the
 * button would have read "ARRIVED", which describes the result as though the user
 * were being told a fact rather than asked to do something.
 *
 * The tone table is the agenda's own, as `packages/ui/src/status-tone.ts` asks: the
 * design system decides what a tone looks like, the feature that owns a status says
 * which tone that status is. Adding a status to the domain therefore fails to
 * compile here, rather than rendering in whatever colour the fallback picks.
 *
 * Which transitions are offered is not in this file, and neither is which of them has
 * to be explained: both are asked of the domain at render time
 * (`allowedAppointmentTransitions`, `requiresTransitionReason`) and the API refuses
 * anything else. This file only says what to call the moves it is handed — so a status
 * added to the domain cannot appear here with a button that lies about what it does.
 */

export { requiresTransitionReason };

import type { AppointmentStatus } from '@denti-code-u3/domain';
import { requiresTransitionReason } from '@denti-code-u3/domain';
import { STATUS_TONE_CLASS, type StatusTone } from '@denti-code-u3/ui';

/**
 * Status → tone.
 *
 * `CANCELLED` and `NO_SHOW` are `danger` rather than `neutral`: both mean the chair
 * went unused, and a receptionist scanning the day needs to see at a glance which
 * blocks are not going to happen.
 */
const APPOINTMENT_STATUS_TONE: Readonly<Record<AppointmentStatus, StatusTone>> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  ARRIVED: 'info',
  IN_TREATMENT: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
};

/** The state, as a noun. Used in the panel and in the grid's accessible name. */
const APPOINTMENT_STATUS_LABEL: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: 'Scheduled',
  CONFIRMED: 'Confirmed',
  ARRIVED: 'Arrived',
  IN_TREATMENT: 'In treatment',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

/**
 * The button that asks for a transition.
 *
 * `SCHEDULED` is the odd one out: it is reachable from `CONFIRMED` (the patient
 * stopped being sure) and from `CANCELLED`/`NO_SHOW` (putting it back), and those
 * three are not the same act. One label per target status would read "Scheduled" on
 * all three, so the label follows the *source* as well — which is why this is a
 * function and not a table.
 */
const TRANSITION_LABEL: Readonly<
  Record<AppointmentStatus, Readonly<Partial<Record<AppointmentStatus, string>>>>
> = {
  SCHEDULED: { CANCELLED: 'Cancel', NO_SHOW: 'Mark as no-show' },
  CONFIRMED: {
    SCHEDULED: 'Unconfirm',
    ARRIVED: 'Check in',
    CANCELLED: 'Cancel',
    NO_SHOW: 'Mark as no-show',
  },
  ARRIVED: { IN_TREATMENT: 'Start treatment', CANCELLED: 'Cancel', NO_SHOW: 'Mark as no-show' },
  IN_TREATMENT: { COMPLETED: 'Complete', CANCELLED: 'Cancel' },
  COMPLETED: {},
  CANCELLED: { SCHEDULED: 'Put back to scheduled' },
  NO_SHOW: { SCHEDULED: 'Put back to scheduled' },
};

export function appointmentStatusTone(status: AppointmentStatus): StatusTone {
  return APPOINTMENT_STATUS_TONE[status];
}

export function appointmentStatusClassName(status: AppointmentStatus): string {
  return STATUS_TONE_CLASS[APPOINTMENT_STATUS_TONE[status]];
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return APPOINTMENT_STATUS_LABEL[status];
}

/**
 * The verb on the button that moves an appointment to `to`.
 *
 * Falls back to the state's own name for any pair the tables above do not name, so a
 * status added to the domain gets a button that says what it does rather than no
 * button at all.
 */
export function appointmentTransitionLabel(from: AppointmentStatus, to: AppointmentStatus): string {
  return TRANSITION_LABEL[from][to] ?? APPOINTMENT_STATUS_LABEL[to];
}
