/**
 * Turning a refused note into one sentence.
 *
 * The sibling of `describe-visit-failure.ts`, separate for the same reason the two
 * appointment describers are: the sentences are about different writes. Both read the
 * envelope identically — the wire code collapses every refusal, so the message is the
 * only place that says *why* — but "The visit was not changed" is a closure's answer,
 * and a note that failed to save deserves to be told about the note.
 *
 * What is shared, deliberately: `NOT_FOUND` says the *visit* is gone, because that is
 * what a 404 on this path always means. The note was never the subject; the visit is,
 * and it was on screen when the clinician typed.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed note, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the closure describer gives: its
 * messages were written for a person by the API, and anything else is developer noise
 * in front of a clinician.
 */
export function describeNoteFailure(error: unknown, fallback: string): string | undefined {
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
      // The visit was on screen when the note was typed and is not there now —
      // closed and deleted on another screen, or a clinic that no longer holds it.
      return 'This visit no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The note was not saved.';
    default:
      return message;
  }
}
