import { describe, expect, it } from 'vitest';

import { hashPassword } from './password-hash.js';

describe('hashPassword', () => {
  it('uses the scrypt format the API verifies', async () => {
    const hash = await hashPassword('a-long-password');
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w+/=]+\$[\w+/=]+$/);
    expect(hash).not.toContain('a-long-password');
  });
});
