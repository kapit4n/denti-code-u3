/**
 * Turning a refused catalogue entry into one sentence.
 *
 * The sibling of `describe-treatment-failure.ts`, separate because the two are
 * about different writes: that one is a clinician recording a treatment on a
 * visit, this one is an administrator adding a procedure the clinic offers. Both
 * read the envelope identically — the wire code collapses every refusal, so the
 * message is the only place that says *why* — but "a treatment no longer in the
 * catalogue" and "this code is already in the catalogue" answer different
 * questions, and quoting the wrong one loses the point of the refusal.
 *
 * The interesting case here is `DOMAIN_RULE_VIOLATION`: the unique
 * `(clinic_id, code)` index reaches the client folded into it, so the server's
 * own sentence — "That code is already in the catalogue" — is what the administrator
 * reads. The code is the only reason that branch exists.
 *
 * `NOT_FOUND` says the *clinic* is gone: the catalogue belongs to the clinic on
 * the header, and a request whose clinic no longer exists has nothing to file
 * under.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a refused catalogue entry, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason its siblings give: its
 * messages were written for a person by the API, and anything else is developer
 * noise in front of whoever was filling in the form.
 */
export interface CatalogueFailureMessages {
  readonly notFound?: string;
  readonly network?: string;
}

export function describeCatalogueFailure(
  error: unknown,
  fallback: string,
  messages?: CatalogueFailureMessages,
): string | undefined {
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
      // The clinic was on screen when the treatment was filed and is not there now.
      return (
        messages?.notFound ?? 'This clinic is no longer available. The treatment was not added.'
      );
    case 'NETWORK_ERROR':
      return messages?.network ?? 'Could not reach the server. The treatment was not added.';
    default:
      return message;
  }
}
