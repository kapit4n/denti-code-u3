/**
 * How a visit status is shown, and which moves this screen may offer.
 *
 * Two vocabularies, the same split `appointment-status-presentation.ts` makes: a
 * *state* is named for the record ("Open", "Completed") because that is what the
 * header reports, and an *action* is named for the act ("Complete visit") because
 * that is what the button promises to do. One table serving both gave the agenda a
 * button reading "ARRIVED", and the same mistake here would read "COMPLETED".
 *
 * The tone table is the design system's vocabulary (`packages/ui/src/status-tone.ts`):
 * the feature that owns a status says which tone that status is, and a status added
 * to the domain then fails to compile here rather than rendering in whatever colour
 * the fallback picks.
 *
 * **The action list is an intersection, and that is the point of this file.**
 * `allowedVisitTransitions` also offers `OPEN → CANCELLED`, but no endpoint
 * implements it — a button for it would be a control that 404s. So the actions are
 * the domain's legal moves ∩ the closures the API can actually perform, asked at
 * render time. When a cancellation endpoint lands it lands here, in both halves at
 * once: a move nobody can make is not an action, and a move with no door is not a
 * button.
 */

import { allowedVisitTransitions, type VisitStatus } from '@denti-code-u3/domain';
import { STATUS_TONE_CLASS, type StatusTone } from '@denti-code-u3/ui';

/**
 * Status → tone.
 *
 * `OPEN` is `warning` for the reason `IN_TREATMENT` is on the agenda: the chair is
 * occupied right now, and a visit that is open is the one thing on the screen that
 * may still be waiting on somebody. `CANCELLED` is `danger` — the chair went unused.
 */
const VISIT_STATUS_TONE: Readonly<Record<VisitStatus, StatusTone>> = {
  OPEN: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

/** The state, as a noun. */
const VISIT_STATUS_LABEL: Readonly<Record<VisitStatus, string>> = {
  OPEN: 'Open',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/**
 * The closures `POST /visits/:id/...` implements today.
 *
 * Not derived from a route table: it is written down here beside the domain's own
 * table so the two are read together, and a new endpoint is one line in each place
 * rather than a discovery that the button was missing.
 */
const CLOSABLE: readonly VisitClosure[] = ['COMPLETED', 'OPEN'];

/**
 * The two statuses a screen may move a visit to, each with its own endpoint.
 *
 * Named here rather than in the mutation that performs it, because it is this file
 * that decides which buttons exist — the mutation's paths and this list are two
 * halves of the same fact, and the type is what stops a button reaching a path that
 * has no endpoint behind it.
 */
export type VisitClosure = Extract<VisitStatus, 'OPEN' | 'COMPLETED'>;

/** The verb on the button that moves a visit to `to`. */
const CLOSURE_LABEL: Readonly<Partial<Record<VisitStatus, string>>> = {
  COMPLETED: 'Complete visit',
  OPEN: 'Reopen visit',
};

export function visitStatusTone(status: VisitStatus): StatusTone {
  return VISIT_STATUS_TONE[status];
}

export function visitStatusClassName(status: VisitStatus): string {
  return STATUS_TONE_CLASS[VISIT_STATUS_TONE[status]];
}

export function visitStatusLabel(status: VisitStatus): string {
  return VISIT_STATUS_LABEL[status];
}

/**
 * The moves this screen offers from `from`, in the domain's order.
 *
 * Empty for a cancelled visit, which cannot be reopened at all — the header then
 * says so in a sentence instead of showing a row of buttons that are not there.
 */
export function visitClosureTransitions(from: VisitStatus): readonly VisitClosure[] {
  return allowedVisitTransitions(from).filter((to): to is VisitClosure =>
    CLOSABLE.includes(to as VisitClosure),
  );
}

export function visitClosureLabel(to: VisitStatus): string {
  return CLOSURE_LABEL[to] ?? VISIT_STATUS_LABEL[to];
}
