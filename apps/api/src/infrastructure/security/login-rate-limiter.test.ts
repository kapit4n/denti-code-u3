import { describe, expect, it } from 'vitest';

import { LoginRateLimiter } from './login-rate-limiter.js';

function createLimiter(overrides: Partial<ConstructorParameters<typeof LoginRateLimiter>[0]> = {}) {
  let now = 1_000_000;
  const limiter = new LoginRateLimiter({
    maxAttempts: 3,
    windowMs: 60_000,
    now: () => now,
    ...overrides,
  });

  return {
    limiter,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('LoginRateLimiter', () => {
  it('allows attempts below the limit and refuses once it is reached', () => {
    const { limiter } = createLimiter();

    expect(limiter.check('person@example.test|127.0.0.1')).toEqual({ allowed: true });
    limiter.recordFailure('person@example.test|127.0.0.1');
    limiter.recordFailure('person@example.test|127.0.0.1');

    expect(limiter.check('person@example.test|127.0.0.1')).toEqual({ allowed: true });

    limiter.recordFailure('person@example.test|127.0.0.1');

    expect(limiter.check('person@example.test|127.0.0.1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('does not count a check as a failure', () => {
    const { limiter } = createLimiter({ maxAttempts: 1 });

    limiter.check('person@example.test|127.0.0.1');
    limiter.check('person@example.test|127.0.0.1');

    expect(limiter.check('person@example.test|127.0.0.1')).toEqual({ allowed: true });
  });

  it('clears the window after a successful sign-in', () => {
    const { limiter } = createLimiter({ maxAttempts: 2 });
    const key = 'person@example.test|127.0.0.1';

    limiter.recordFailure(key);
    limiter.recordFailure(key);
    expect(limiter.check(key)).toMatchObject({ allowed: false });

    limiter.recordSuccess(key);
    expect(limiter.check(key)).toEqual({ allowed: true });

    limiter.recordFailure(key);
    expect(limiter.check(key)).toEqual({ allowed: true });
  });

  it('forgets failures once the window has passed', () => {
    const { limiter, advance } = createLimiter({ maxAttempts: 2 });
    const key = 'person@example.test|127.0.0.1';

    limiter.recordFailure(key);
    limiter.recordFailure(key);
    expect(limiter.check(key)).toMatchObject({ allowed: false });

    advance(60_001);

    expect(limiter.check(key)).toEqual({ allowed: true });
  });

  it('keeps different emails and addresses independent', () => {
    const { limiter } = createLimiter({ maxAttempts: 1 });

    limiter.recordFailure('first@example.test|127.0.0.1');

    expect(limiter.check('first@example.test|127.0.0.1')).toMatchObject({ allowed: false });
    expect(limiter.check('second@example.test|127.0.0.1')).toEqual({ allowed: true });
    expect(limiter.check('first@example.test|10.0.0.2')).toEqual({ allowed: true });
  });

  it('rounds the refusal wait up to whole seconds', () => {
    const { limiter, advance } = createLimiter({ maxAttempts: 1 });

    limiter.recordFailure('person@example.test|127.0.0.1');
    advance(1_500);

    expect(limiter.check('person@example.test|127.0.0.1')).toEqual({
      allowed: false,
      retryAfterSeconds: 59,
    });
  });

  it('prunes expired keys and evicts the oldest when over capacity', () => {
    const { limiter, advance } = createLimiter({ maxAttempts: 1, maxKeys: 2 });

    limiter.recordFailure('a|1');
    limiter.recordFailure('b|1');
    expect(limiter.size).toBe(2);

    advance(60_001);
    limiter.recordFailure('c|1');
    // `a` and `b` have expired and are dropped, so only `c` remains.
    expect(limiter.size).toBe(1);

    limiter.recordFailure('d|1');
    limiter.recordFailure('e|1');
    // At capacity with live windows: the longest-tracked key is evicted.
    expect(limiter.size).toBe(2);
    expect(limiter.check('c|1')).toEqual({ allowed: true });
  });

  it('rejects nonsensical configuration', () => {
    expect(() => new LoginRateLimiter({ maxAttempts: 0, windowMs: 1_000 })).toThrow(RangeError);
    expect(() => new LoginRateLimiter({ maxAttempts: 1, windowMs: 0 })).toThrow(RangeError);
    expect(() => new LoginRateLimiter({ maxAttempts: 1, windowMs: 1_000, maxKeys: 0 })).toThrow(
      RangeError,
    );
  });
});
