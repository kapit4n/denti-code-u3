/**
 * Turning a refused prescription into one sentence.
 *
 * The sibling of `describe-note-failure.ts`, separate for the same reason the note
 * and treatment describers are: the sentences are about different writes. Both read
 * the envelope identically — the wire code collapses every refusal, so the message
 * is the only place that says *why* — but a course the API refused and a visit this
 * clinic does not hold name different subjects, and each refusal deserves its own
 * sentence.
 *
 * `VALIDATION_ERROR` covers the talks-to-the-record refusals — a course that does
 * not say what to take, a route the product does not know, a course that is not
 * whole days. `NOT_FOUND` says the *visit* is gone, because that is what a 404 on
 * this path always means: the visit is the subject, it was on screen when the
 * clinician prescribed, and it is not there now.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed prescription, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the note describer gives: its
 * messages were written for a person by the API, and anything else is developer
 * noise in front of a clinician.
 */
export function describePrescriptionFailure(error: unknown, fallback: string): string | undefined {
  if (!error) {
    return undefined;
  }

  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  const message = error.message || fallback;

  switch (error.code) {
    case 'VALIDATION_ERROR':
    case 'DOMAIN_RULE_VIOLATION':
      return message;
    case 'NOT_FOUND':
      // The visit was on screen when the course was written and is not there now —
      // closed and deleted on another screen, or a clinic that no longer holds it.
      return 'This visit no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The prescription was not written.';
    default:
      return message;
  }
}
