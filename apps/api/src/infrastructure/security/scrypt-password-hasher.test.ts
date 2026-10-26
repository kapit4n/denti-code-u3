/**
 * The scrypt password hasher.
 *
 * These are the properties a password store has to have: the same password hashes
 * differently every time (salt), the right password verifies, the wrong one does
 * not, and a malformed stored value is a refusal rather than a crash. The cost is
 * real scrypt, because the point of the implementation is that it uses real
 * scrypt — a fake would test nothing.
 */

import { describe, expect, it } from 'vitest';

import { ScryptPasswordHasher } from './scrypt-password-hasher.js';

const hasher = new ScryptPasswordHasher();

describe('ScryptPasswordHasher', () => {
  it('produces the documented self-describing format', async () => {
    const stored = await hasher.hash('correct horse');
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toBe('16384');
    expect(parts[2]).toBe('8');
    expect(parts[3]).toBe('1');
  });

  it('salts, so the same password hashes differently each time', async () => {
    const first = await hasher.hash('correct horse');
    const second = await hasher.hash('correct horse');
    expect(first).not.toBe(second);
    // Both still verify: the salt is in the value, not a guess.
    expect(await hasher.verify('correct horse', first)).toBe(true);
    expect(await hasher.verify('correct horse', second)).toBe(true);
  });

  it('verifies the right password and refuses the wrong one', async () => {
    const stored = await hasher.hash('correct horse');
    expect(await hasher.verify('correct horse', stored)).toBe(true);
    expect(await hasher.verify('correct hors', stored)).toBe(false);
    expect(await hasher.verify('', stored)).toBe(false);
  });

  it('refuses a malformed or truncated stored value instead of throwing', async () => {
    expect(await hasher.verify('x', '')).toBe(false);
    expect(await hasher.verify('x', 'not-a-hash')).toBe(false);
    expect(await hasher.verify('x', 'scrypt$16384$8$1$abc')).toBe(false);
    expect(await hasher.verify('x', 'bcrypt$1$2$3$c2FsdA==$aGFzaA==')).toBe(false);
  });

  it('refuses a stored value whose cost parameters are absurd', async () => {
    // A hash is attacker-influenced only if the table is; even so, a huge N would
    // be a denial of service, so it is rejected as unreadable rather than run.
    expect(await hasher.verify('x', 'scrypt$99999999$8$1$c2FsdA==$aGFzaA==')).toBe(false);
  });
});
