/**
 * Turning a refused visit closure into one sentence.
 *
 * The counterpart of `describe-appointment-failure.ts`, and much smaller because a
 * visit closure has no schedule to conflict with: nothing here quotes an hour, so
 * nothing here needs the clinic's timezone. That is the whole difference, and it is
 * why the two are separate files rather than one function with a timezone it only
 * sometimes uses.
 *
 * **The server's sentence is shown for a rule refusal**, for the same reason the
 * appointment path shows it: `toApiErrorCode` folds every domain refusal into one
 * wire code (`DOMAIN_RULE_VIOLATION`), so the status says *that* it was refused and
 * the message is the only place that says *why* — "Visit cannot move from OPEN to
 * OPEN", written by the domain for a person.
 *
 * Every message is built from the envelope the API answered with; when the envelope
 * cannot be read the sentence falls back rather than inventing a reason.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed closure, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is ever quoted. Its messages were written for a person
 * by the API; anything else — a stub that threw, a component bug, a proxy's own
 * `Error` — is developer noise, and showing it in an alert puts a stack-adjacent
 * sentence in front of a clinician while the fallback next to it says what actually
 * happened.
 */
export function describeVisitFailure(error: unknown, fallback: string): string | undefined {
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
      // The record was on screen when the button was pressed and is not there now —
      // closed on another screen, or a clinic that no longer holds it. Not a fault
      // to retry, and not a rule either.
      return 'This visit no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The visit was not changed.';
    default:
      // Everything else, including a code this build has never heard of. The API
      // builds those messages for a client — never SQL, never driver text — so a
      // refusal explained in its own words beats a generic apology.
      return message;
  }
}
