/**
 * Tests for the refusal sentences.
 *
 * Small on purpose: the load-bearing behaviour is *which* envelope field is read —
 * a rule refusal must show the server's sentence (the wire code collapses every
 * refusal into one, so the message is the only place that says why), and a missing
 * visit must not be reported as a rule violation.
 */

import { ApiClientError } from '@denti-code-u3/api-client';
import { describe, expect, it } from 'vitest';

import { describeVisitFailure } from './describe-visit-failure.js';

describe('describeVisitFailure', () => {
  it('answers nothing when nothing failed', () => {
    expect(describeVisitFailure(undefined, 'fallback')).toBeUndefined();
    expect(describeVisitFailure(null, 'fallback')).toBeUndefined();
  });

  it('shows the domain’s own sentence for a rule refusal', () => {
    const error = new ApiClientError(
      'DOMAIN_RULE_VIOLATION',
      'Visit cannot move from COMPLETED to COMPLETED',
      409,
    );
    expect(describeVisitFailure(error, 'fallback')).toBe(
      'Visit cannot move from COMPLETED to COMPLETED',
    );
  });

  it('names a visit that is gone rather than quoting the envelope', () => {
    const error = new ApiClientError('NOT_FOUND', 'Visit 1 was not found', 404);
    expect(describeVisitFailure(error, 'fallback')).toBe(
      'This visit no longer exists in the current clinic.',
    );
  });

  it('says the write did not happen when the server could not be reached', () => {
    const error = new ApiClientError('NETWORK_ERROR', 'unreachable', 0);
    expect(describeVisitFailure(error, 'fallback')).toBe(
      'Could not reach the server. The visit was not changed.',
    );
  });

  it('falls back rather than showing an empty alert', () => {
    const empty = new ApiClientError('INTERNAL_ERROR', '', 500);
    expect(describeVisitFailure(empty, 'The visit could not be updated.')).toBe(
      'The visit could not be updated.',
    );
  });

  it('degrades an unknown failure into the fallback', () => {
    expect(describeVisitFailure(new Error('boom'), 'The visit could not be updated.')).toBe(
      'The visit could not be updated.',
    );
  });
});
