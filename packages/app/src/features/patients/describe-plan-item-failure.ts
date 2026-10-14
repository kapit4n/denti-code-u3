/**
 * Turning a refused "mark done" into one sentence.
 *
 * The third of the patient-write describers, after the odontogram and the plan.
 * It is separate because its 404 means something its siblings' does not: the path
 * names a patient *and* a plan *and* an item, so a 404 can come from any of the
 * three being gone. The sentence names the item rather than the patient, because
 * marking one row done is what was asked and a plan that was replaced underneath
 * the screen is the likelier disappearance.
 *
 * `VALIDATION_ERROR` and `DOMAIN_RULE_VIOLATION` are quoted; everything else falls
 * back, for the reasons the odontogram describer gives.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

export function describePlanItemFailure(error: unknown, fallback: string): string | undefined {
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
      return 'That treatment plan item is no longer on this patient.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The item was not marked done.';
    default:
      return message;
  }
}
