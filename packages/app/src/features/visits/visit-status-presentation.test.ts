/**
 * Tests for the visit status presentation.
 *
 * The load-bearing assertion is the intersection in `visitClosureTransitions`: the
 * domain allows `OPEN → CANCELLED` and no endpoint implements it, so the screen must
 * offer exactly `OPEN → COMPLETED` and `COMPLETED → OPEN`. A button the API cannot
 * answer is the defect these tests exist to prevent, and a status added to the
 * domain must fail here rather than render in the fallback's colour.
 */

import { VISIT_STATUSES, type VisitStatus } from '@denti-code-u3/domain';
import { describe, expect, it } from 'vitest';

import {
  visitClosureLabel,
  visitClosureTransitions,
  visitStatusClassName,
  visitStatusLabel,
  visitStatusTone,
} from './visit-status-presentation.js';

describe('visit status presentation', () => {
  it('names every status in the domain, as a state and as a tone', () => {
    for (const status of VISIT_STATUSES) {
      expect(visitStatusLabel(status)).toBeTruthy();
      expect(visitStatusTone(status)).toBeTruthy();
      expect(visitStatusClassName(status)).toContain('bg-');
    }
  });

  it('offers only the closures the API implements', () => {
    expect(visitClosureTransitions('OPEN')).toEqual(['COMPLETED']);
    expect(visitClosureTransitions('COMPLETED')).toEqual(['OPEN']);
  });

  it('offers nothing from a cancelled visit, which cannot be reopened', () => {
    expect(visitClosureTransitions('CANCELLED')).toEqual([]);
  });

  it('never offers a move the endpoints cannot perform', () => {
    // The domain allows OPEN → CANCELLED; no endpoint implements it, so it must
    // not appear as a button on any status.
    for (const from of VISIT_STATUSES as readonly VisitStatus[]) {
      expect(visitClosureTransitions(from)).not.toContain('CANCELLED');
    }
  });

  it('labels each closure with the act, not with the state', () => {
    expect(visitClosureLabel('COMPLETED')).toBe('Complete visit');
    expect(visitClosureLabel('OPEN')).toBe('Reopen visit');
  });
});
