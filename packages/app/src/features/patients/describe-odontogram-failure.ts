/**
 * Turning a refused charting into one sentence.
 *
 * The sibling of `describe-attachment-failure.ts`, separate for the same reason:
 * the sentences are about different writes. Both read the envelope identically —
 * the wire code collapses every refusal, so the message is the only place that
 * says *why* — but "The file could not be attached" is a file's answer, and a
 * finding the chart refused deserves to be told about the finding.
 *
 * What is shared, deliberately: `NOT_FOUND` says the *patient* is gone, because
 * that is what a 404 on this path always means. The tooth was never the subject;
 * the patient is, and her profile was on screen when the tooth was charted.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed charting, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the attachment describer
 * gives: its messages were written for a person by the API, and anything else is
 * developer noise in front of the clinician.
 */
export function describeOdontogramFailure(error: unknown, fallback: string): string | undefined {
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
      // The patient was on screen when the tooth was charted and is not there now.
      return 'This patient no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The tooth was not charted.';
    default:
      return message;
  }
}
