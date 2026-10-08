/**
 * Turning a refused attachment into one sentence.
 *
 * The sibling of `describe-note-failure.ts`, separate for the same reason the two
 * appointment describers are: the sentences are about different writes. Both read
 * the envelope identically — the wire code collapses every refusal, so the message
 * is the only place that says *why* — but "The note could not be saved" is a
 * note's answer, and a file that failed to attach deserves to be told about the
 * file.
 *
 * What is shared, deliberately: `NOT_FOUND` says the *visit* is gone, because that
 * is what a 404 on this path always means. The file was never the subject; the
 * visit is, and it was on screen when the front desk attached it.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed attachment, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the note describer gives:
 * its messages were written for a person by the API, and anything else is
 * developer noise in front of the front desk.
 */
export function describeAttachmentFailure(error: unknown, fallback: string): string | undefined {
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
      // The visit was on screen when the file was attached and is not there now.
      return 'This visit no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The file was not attached.';
    default:
      return message;
  }
}
