/**
 * Turning a refused write into one sentence the receptionist can act on.
 *
 * The counterpart of `describe-patient-failure.ts` for the schedule, and kept apart
 * from it because the two answer different questions. A patient write is refused for
 * a field; a schedule write is refused because *the clinic is full at that hour*, and
 * the one thing that makes that answerable is a time.
 *
 * Two decisions worth stating:
 *
 *  - **A conflict is answered with the hour it collides at, not with the server's
 *    sentence.** "The appointment overlaps 1 existing appointment(s)" is written for a
 *    log. What the user needs is `09:00 – 10:00`, because the next thing they do is
 *    look at that hour — and the times come out of the envelope's `details` in the
 *    clinic's own timezone, because a time in the visitor's zone names a different
 *    hour of the same day.
 *  - **The user's timezone is never used to explain a conflict.** Same reason as the
 *    grid: two screens in the same app must not disagree about when 09:00 is.
 *
 * The API is still the authority. Every message here is built from the envelope it
 * answered with; when `details` cannot be read the sentence simply loses the time
 * rather than inventing one.
 */

import type { ApiClientError } from '@denti-code-u3/api-client';
import { scheduleConflictDetailsSchema } from '@denti-code-u3/validation';

import { formatClinicTimeRange } from '../clinic/format-clinic-time.js';

export interface AppointmentFailureContext {
  /** The clinic's IANA zone, so a quoted time is the hour the clinic is working. */
  readonly timeZone: string;
  /** Used when the API sent no message of its own. */
  readonly fallback: string;
}

/**
 * One sentence about a failed schedule write, or `undefined` when nothing failed.
 *
 * `||`, not `??`, on every message: an empty string is what a proxy or an unhandled
 * fault arrives with, and `??` would let it through to an alert with no text in it,
 * which a user reads as "no error" while the write has quietly failed.
 */
export function describeAppointmentFailure(
  error: unknown,
  context: AppointmentFailureContext,
): string | undefined {
  if (!error) {
    return undefined;
  }

  const apiError = error as Partial<ApiClientError>;
  const message = apiError.message || context.fallback;

  switch (apiError.code) {
    case 'SCHEDULING_CONFLICT':
      return describeConflict(apiError.details, context.timeZone);
    case 'VALIDATION_ERROR':
    case 'DOMAIN_RULE_VIOLATION':
      // The domain already writes these for a person: "The clinic opens at 08:00 on
      // 2026-10-11", "A COMPLETED appointment can no longer be rescheduled". Listed
      // rather than folded into the default so the decision is visible: showing the
      // server's sentence is only right because the API marks it client-safe.
      return message;
    case 'NOT_FOUND':
      // The row was there when the grid drew it and is not any more — deleted on
      // another screen, or a clinic that no longer exists. Not a fault to retry.
      return 'That appointment no longer exists.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check the connection and try again.';
    default:
      // Everything else, including a code this build has never heard of. The API
      // builds those messages for a client — never SQL, never driver text — so a
      // refusal explained in its own words beats a generic apology, and a new code
      // degrades into a sentence rather than into silence.
      return message;
  }
}

/**
 * "When" the slot is taken, in the clinic's own clock.
 *
 * The envelope's `details.conflicts` is the only place the clashing hours exist. If
 * it cannot be read — a proxy that rewrote the body, an API that grew a field — the
 * sentence keeps its meaning and drops the detail, because a wrong time is worse
 * than no time.
 */
function describeConflict(details: unknown, timeZone: string): string {
  const parsed = scheduleConflictDetailsSchema.safeParse(details);
  if (!parsed.success || parsed.data.conflicts.length === 0) {
    return 'That time is already booked for this dentist or chair.';
  }

  const spans = parsed.data.conflicts
    .map((conflict) => formatClinicTimeRange(conflict.startsAt, conflict.endsAt, timeZone))
    .filter((span) => span !== '—');

  if (spans.length === 0) {
    return 'That time is already booked for this dentist or chair.';
  }

  if (spans.length === 1) {
    const [span] = spans;
    return `That time overlaps an appointment already booked, ${span}. Move it, or pick another slot.`;
  }

  return `That time overlaps ${spans.length} appointments already booked: ${spans.join(', ')}. Move one of them, or pick another slot.`;
}
