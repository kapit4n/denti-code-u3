/**
 * Turning a refused treatment plan into one sentence.
 *
 * The sibling of `describe-odontogram-failure.ts`, separate for the same reason:
 * the sentences are about different writes. Both read the envelope identically —
 * the wire code collapses every refusal, so the message is the only place that
 * says *why* — but "The finding was not charted" is an odontogram's answer, and a
 * plan the clinic refused deserves to be told about the plan.
 *
 * `NOT_FOUND` says the *patient* is gone, because that is what a 404 on
 * `/patients/:id/treatment-plans` always means: the plan is created under the
 * patient who was on screen, and she is the only subject that path can name.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed plan, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the odontogram describer
 * gives: its messages were written for a person by the API, and anything else is
 * developer noise in front of the clinician.
 */
export interface TreatmentPlanFailureMessages {
  readonly notFound?: string;
  readonly network?: string;
}

export function describeTreatmentPlanFailure(
  error: unknown,
  fallback: string,
  messages?: TreatmentPlanFailureMessages,
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
      return messages?.notFound ?? 'This patient no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return messages?.network ?? 'Could not reach the server. The plan was not saved.';
    default:
      return message;
  }
}
