/**
 * Turning a failed request into one sentence the receptionist can act on.
 *
 * Shared by the registration form and the edit form, because the API answers both
 * with the same problem envelope and a user should not meet two different voices
 * for the same failure.
 */

import type { ApiClientError } from '@denti-code-u3/api-client';

/**
 * A 422 means the API rejected a rule the form does not know about — a birth date
 * in the future, most likely. Showing that message beats "something went wrong",
 * because the server already knows what is wrong.
 *
 * @param fallback Used when the API sent no message of its own.
 */
export function describePatientFailure(error: unknown, fallback: string): string | undefined {
  if (!error) {
    return undefined;
  }

  const apiError = error as Partial<ApiClientError>;

  // `||`, not `??`, on every message below. An empty string is what a proxy or an
  // unhandled server fault arrives with, and `??` lets it straight through — the
  // alert then renders with no text in it, which a user reads as "no error" while
  // the save has quietly failed.
  switch (apiError.code) {
    case 'VALIDATION_ERROR':
    case 'DOMAIN_RULE_VIOLATION':
      return apiError.message || 'Some of these details are not valid.';
    case 'NOT_FOUND':
      return 'That patient no longer exists, or is not in this clinic.';
    case 'SCHEDULING_CONFLICT':
      return apiError.message || 'That record already exists.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check the connection and try again.';
    default:
      return apiError.message || fallback;
  }
}
