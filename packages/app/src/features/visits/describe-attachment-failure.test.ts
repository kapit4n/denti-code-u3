/**
 * Tests for the attachment's refusal sentences.
 *
 * The shared envelope-reading rules are `describe-visit-failure.test.ts`'s to pin
 * down; what is asserted here is the one thing that differs — that a network failure
 * talks about the *file* — and the one that must not: a visit that is gone is reported
 * as a visit that is gone, because the file was never the subject.
 */

import { ApiClientError } from '@denti-code-u3/api-client';
import { describe, expect, it } from 'vitest';

import { describeAttachmentFailure } from './describe-attachment-failure.js';

describe('describeAttachmentFailure', () => {
  it('answers nothing when nothing failed', () => {
    expect(describeAttachmentFailure(undefined, 'fallback')).toBeUndefined();
    expect(describeAttachmentFailure(null, 'fallback')).toBeUndefined();
  });

  it('shows the domain’s own sentence for a refusal', () => {
    const error = new ApiClientError('VALIDATION_ERROR', 'A file needs a name', 422);
    expect(describeAttachmentFailure(error, 'fallback')).toBe('A file needs a name');
  });

  it('names the visit that is gone, not the file that was not attached', () => {
    const error = new ApiClientError('NOT_FOUND', 'Visit 1 was not found', 404);
    expect(describeAttachmentFailure(error, 'fallback')).toBe(
      'This visit no longer exists in the current clinic.',
    );
  });

  it('says the file was not attached when the server could not be reached', () => {
    const error = new ApiClientError('NETWORK_ERROR', 'unreachable', 0);
    expect(describeAttachmentFailure(error, 'The file could not be attached.')).toBe(
      'Could not reach the server. The file was not attached.',
    );
  });

  it('falls back rather than showing an empty alert', () => {
    const empty = new ApiClientError('INTERNAL_ERROR', '', 500);
    expect(describeAttachmentFailure(empty, 'The file could not be attached.')).toBe(
      'The file could not be attached.',
    );
  });

  it('degrades an unknown failure into the fallback', () => {
    expect(describeAttachmentFailure(new Error('boom'), 'The file could not be attached.')).toBe(
      'The file could not be attached.',
    );
  });
});
