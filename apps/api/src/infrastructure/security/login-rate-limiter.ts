/**
 * A fixed-window limiter for failed sign-in attempts.
 *
 * It exists to make password guessing expensive without turning a busy clinic
 * into a victim: only *failures* count, and the key is the email **and** the
 * client address, so one shared reception terminal cannot lock out an account for
 * everybody else. A successful sign-in clears the key, because the person who
 * knows the password has already answered the question.
 *
 * State is per process and in memory (ADR 0029). That is enough for the current
 * single-instance deployment and needs no database round-trip on the login path;
 * a multi-instance deployment must move the counter to shared storage or put a
 * limiter in front of the API.
 */

export interface LoginRateLimiterOptions {
  /** Failures allowed in one window before further attempts are refused. */
  readonly maxAttempts: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Injectable for tests; defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Safety valve for memory, not a tuning knob: once this many distinct keys are
   * tracked, expired entries are pruned and then the oldest are evicted.
   */
  readonly maxKeys?: number;
}

export type LoginRateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

interface AttemptWindow {
  failures: number;
  resetAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class LoginRateLimiter {
  readonly #maxAttempts: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #maxKeys: number;
  readonly #windows = new Map<string, AttemptWindow>();

  constructor({
    maxAttempts,
    windowMs,
    now = Date.now,
    maxKeys = DEFAULT_MAX_KEYS,
  }: LoginRateLimiterOptions) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive integer');
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new RangeError('windowMs must be a positive number');
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new RangeError('maxKeys must be a positive integer');
    }

    this.#maxAttempts = maxAttempts;
    this.#windowMs = windowMs;
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  /** Whether an attempt may proceed now, and for how long a refusal stands. */
  check(key: string): LoginRateLimitDecision {
    const current = this.#windows.get(key);
    if (!current) {
      return { allowed: true };
    }

    const now = this.#now();
    if (current.resetAt <= now) {
      this.#windows.delete(key);
      return { allowed: true };
    }

    if (current.failures < this.#maxAttempts) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  /** Counts a refused credential check. Called only for authentication failures. */
  recordFailure(key: string): void {
    const now = this.#now();
    const current = this.#windows.get(key);

    if (!current || current.resetAt <= now) {
      this.#windows.set(key, { failures: 1, resetAt: now + this.#windowMs });
    } else {
      current.failures += 1;
    }

    this.#prune(now);
  }

  /** The password was accepted, so the slate is clean for this key. */
  recordSuccess(key: string): void {
    this.#windows.delete(key);
  }

  /** Visible for tests: how many keys are tracked right now. */
  get size(): number {
    return this.#windows.size;
  }

  #prune(now: number): void {
    if (this.#windows.size <= this.#maxKeys) {
      return;
    }

    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) {
        this.#windows.delete(key);
      }
    }

    // Map preserves insertion order, so the front is the key that has been
    // tracked longest. This is an approximation of "oldest window", which is all
    // a safety valve needs to be.
    while (this.#windows.size > this.#maxKeys) {
      const oldest = this.#windows.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#windows.delete(oldest);
    }
  }
}
