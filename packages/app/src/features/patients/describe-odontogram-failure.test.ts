/**
 * Tests for the odontogram's refusal sentences.
 *
 * The shared envelope-reading rules are `describe-visit-failure.test.ts`'s to pin
 * down; what is asserted here is the one thing that differs — that a network
 * failure talks about the *tooth* — and the one that must not: a patient that is
 * gone is reported as a patient that is gone, because the tooth was never the
 * subject.
 */

import { ApiClientError } from '@denti-code-u3/api-client';
import { describe, expect, it } from 'vitest';

import { describeOdontogramFailure } from './describe-odontogram-failure.js';

describe('describeOdontogramFailure', () => {
  it('answers nothing when nothing failed', () => {
    expect(describeOdontogramFailure(undefined, 'fallback')).toBeUndefined();
    expect(describeOdontogramFailure(null, 'fallback')).toBeUndefined();
  });

  it('shows the domain’s own sentence for a refusal', () => {
    const error = new ApiClientError(
      'VALIDATION_ERROR',
      'A finding must affect at least one surface',
      422,
    );
    expect(describeOdontogramFailure(error, 'fallback')).toBe(
      'A finding must affect at least one surface',
    );
  });

  it('names the patient that is gone, not the tooth that was not charted', () => {
    const error = new ApiClientError('NOT_FOUND', 'Patient 1 was not found', 404);
    expect(describeOdontogramFailure(error, 'fallback')).toBe(
      'This patient no longer exists in the current clinic.',
    );
  });

  it('says the tooth was not charted when the server could not be reached', () => {
    const error = new ApiClientError('NETWORK_ERROR', 'unreachable', 0);
    expect(describeOdontogramFailure(error, 'The tooth could not be charted.')).toBe(
      'Could not reach the server. The tooth was not charted.',
    );
  });

  it('falls back rather than showing an empty alert', () => {
    const empty = new ApiClientError('INTERNAL_ERROR', '', 500);
    expect(describeOdontogramFailure(empty, 'The tooth could not be charted.')).toBe(
      'The tooth could not be charted.',
    );
  });

  it('degrades an unknown failure into the fallback', () => {
    expect(describeOdontogramFailure(new Error('boom'), 'The tooth could not be charted.')).toBe(
      'The tooth could not be charted.',
    );
  });
});
