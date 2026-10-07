/**
 * Tests for the note's refusal sentences.
 *
 * The shared envelope-reading rules are `describe-visit-failure.test.ts`'s to pin
 * down; what is asserted here is the one thing that differs — that a network failure
 * talks about the *note* — and the one that must not: a visit that is gone is reported
 * as a visit that is gone, because the note was never the subject.
 */

import { ApiClientError } from '@denti-code-u3/api-client';
import { describe, expect, it } from 'vitest';

import { describeNoteFailure } from './describe-note-failure.js';

describe('describeNoteFailure', () => {
  it('answers nothing when nothing failed', () => {
    expect(describeNoteFailure(undefined, 'fallback')).toBeUndefined();
    expect(describeNoteFailure(null, 'fallback')).toBeUndefined();
  });

  it('shows the domain’s own sentence for a refusal', () => {
    const error = new ApiClientError('VALIDATION_ERROR', 'A note needs a body', 422);
    expect(describeNoteFailure(error, 'fallback')).toBe('A note needs a body');
  });

  it('names the visit that is gone, not the note that was not written', () => {
    const error = new ApiClientError('NOT_FOUND', 'Visit 1 was not found', 404);
    expect(describeNoteFailure(error, 'fallback')).toBe(
      'This visit no longer exists in the current clinic.',
    );
  });

  it('says the note was not saved when the server could not be reached', () => {
    const error = new ApiClientError('NETWORK_ERROR', 'unreachable', 0);
    expect(describeNoteFailure(error, 'The note could not be saved.')).toBe(
      'Could not reach the server. The note was not saved.',
    );
  });

  it('falls back rather than showing an empty alert', () => {
    const empty = new ApiClientError('INTERNAL_ERROR', '', 500);
    expect(describeNoteFailure(empty, 'The note could not be saved.')).toBe(
      'The note could not be saved.',
    );
  });

  it('degrades an unknown failure into the fallback', () => {
    expect(describeNoteFailure(new Error('boom'), 'The note could not be saved.')).toBe(
      'The note could not be saved.',
    );
  });
});
