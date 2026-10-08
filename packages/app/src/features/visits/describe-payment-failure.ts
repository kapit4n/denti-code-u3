/**
 * Turning a refused payment into one sentence.
 *
 * The sibling of `describe-charge-failure.ts`, separate for the same reason every
 * write's describer is separate: the sentences are about different writes. Both read
 * the envelope identically — the wire code collapses every refusal, so the message
 * is the only place that says *why* — but a settlement the API refused and a visit
 * this clinic does not hold name different subjects, and each refusal deserves its
 * own sentence.
 *
 * `VALIDATION_ERROR` covers the talks-to-the-record refusals — an unlawful amount, a
 * payment more than the bill is worth, a blank or over-long reference, the "nothing
 * left to pay" boundary that follows once a bill was settled (an open question,
 * recorded in `docs/open-questions.md`, until the invoice ledger lands). `NOT_FOUND`
 * says the *visit* is gone, because that is what a 404 on this path always means.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

/**
 * One sentence about a failed payment, or `undefined` when nothing failed.
 *
 * Only an `ApiClientError` is quoted, for the reason the charge describer gives: its
 * messages were written for a person by the API, and anything else is developer
 * noise in front of the front desk.
 */
export function describePaymentFailure(error: unknown, fallback: string): string | undefined {
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
      // The visit was on screen when the payment was recorded and is not there now —
      // closed and deleted on another screen, or a clinic that no longer holds it.
      return 'This visit no longer exists in the current clinic.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. The payment was not recorded.';
    default:
      return message;
  }
}
