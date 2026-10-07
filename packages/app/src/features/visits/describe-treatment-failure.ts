/**
 * Turning a refused treatment record into one sentence.
 *
 * The sibling of `describe-note-failure.ts`, separate for the same reason the two
 * note and visit describers are: the sentences are about different writes. Both
 * read the envelope identically — the wire code collapses every refusal, so the
 * message is the only place that says *why* — but a treatment a clinic does not
 * offer and a visit this clinic does not hold name different subjects, and each
 * refusal deserves its own sentence.
 *
 * `VALIDATION_ERROR` covers the talks-to-the-record refusals — an FDI tooth that
 * names no tooth, notes past the length they can be stored at, and the two reads
 * the domain performs ("this clinic's catalogue" answered for a treatment it does
 * not hold). `NOT_FOUND` says the *visit* is gone, because that is what a 404 on
 * this path always means: the visit is the subject, it was on screen when the
 * clinician typed, and it is not there now.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed treatment record, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the note describer gives: its
 * messages were written for a person by the API, and anything else is developer
 * noise in front of a clinician.
 */
export function describeTreatmentFailure(error: unknown, fallback: string): string | undefined {
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
      // The visit was on screen when the treatment was recorded and is not there
      // now — closed and deleted on another screen, or a clinic that no longer
      // holds it.
      return 'This visit no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The treatment was not recorded.';
    default:
      return message;
  }
}
