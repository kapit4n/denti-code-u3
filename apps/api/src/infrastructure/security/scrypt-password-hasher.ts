/**
 * Password hashing, via Node's built-in `scrypt`.
 *
 * **Why scrypt and not bcrypt/argon2.** Both of those are native addons: an
 * install step that compiles C, a rebuild per Node major, and a supply-chain
 * surface for a clinic that has to trust this binary. `scrypt` is in
 * `node:crypto`, is memory-hard, and is the algorithm Node documents for exactly
 * this job. The alternative that costs nothing to add is the one that ships.
 *
 * **The stored format is self-describing.** `scrypt$N$r$p$salt$hash`, all base64,
 * so the parameters travel with the hash. Raising the cost later means new
 * hashes use the new cost and old ones still verify — no migration, no flag day.
 *
 * **Verification is constant-time.** `timingSafeEqual`, never `===`: a string
 * compare leaks how many leading bytes matched, one probe at a time. The two
 * buffers are compared only after a length check that cannot itself be timed into
 * a useful signal (a wrong hash length is not a secret worth keeping).
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHasher } from '@denti-code-u3/domain';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Cost parameters. N must be a power of two; these are the Node defaults plus headroom. */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const ALGORITHM = 'scrypt';
/**
 * scrypt needs roughly `128 * N * r` bytes plus overhead; the default 32 MiB cap
 * rejects N=16384 with room to spare once `r` is counted. Raised explicitly so a
 * future N bump does not silently start throwing.
 */
const MAX_MEM = 64 * 1024 * 1024;

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scryptAsync(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
    return [
      ALGORITHM,
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const parsed = parseStoredHash(storedHash);
    if (!parsed) {
      // A hash we cannot read is a refusal, never an error: a corrupt row must not
      // let a caller in, and must not tell them why they were kept out.
      return false;
    }

    const derived = await scryptAsync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEM,
    });

    if (derived.length !== parsed.hash.length) {
      return false;
    }
    return timingSafeEqual(derived, parsed.hash);
  }
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function parseStoredHash(stored: string): ParsedHash | undefined {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return undefined;
  }

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  // Guard the parameters: an attacker-supplied stored hash with a huge N would be
  // a denial of service if we trusted it. Anything out of range is unreadable.
  if (!isPositiveInteger(N) || !isPositiveInteger(r) || !isPositiveInteger(p)) {
    return undefined;
  }
  if (N > 1_048_576 || r > 32 || p > 16) {
    return undefined;
  }

  return {
    N,
    r,
    p,
    salt: Buffer.from(rawSalt ?? '', 'base64'),
    hash: Buffer.from(rawHash ?? '', 'base64'),
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
