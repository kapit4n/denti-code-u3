import { describe, expect, it } from 'vitest';
import { describeTreatmentPlanProgress } from './treatment-plan.js';

describe('describeTreatmentPlanProgress', () => {
  it('counts done lines against the whole plan, rounding the percentage', () => {
    const progress = describeTreatmentPlanProgress([
      { isCompleted: true },
      { isCompleted: true },
      { isCompleted: true },
      { isCompleted: false },
    ]);

    expect(progress).toEqual({
      total: 4,
      completed: 3,
      inProgress: 0,
      pending: 1,
      percentComplete: 75,
    });
  });

  it('is 0 percent for a plan whose lines are all open', () => {
    const progress = describeTreatmentPlanProgress([
      { isCompleted: false },
      { isCompleted: false },
    ]);

    expect(progress.percentComplete).toBe(0);
    expect(progress.completed).toBe(0);
  });

  it('is 100 percent for a fully completed plan', () => {
    const progress = describeTreatmentPlanProgress([{ isCompleted: true }]);

    expect(progress).toMatchObject({ completed: 1, pending: 0, percentComplete: 100 });
  });

  it('is 0 percent for a plan with no items, not a division by zero', () => {
    const progress = describeTreatmentPlanProgress([]);

    expect(progress).toMatchObject({ total: 0, completed: 0, percentComplete: 0 });
  });
});
