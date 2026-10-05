/**
 * The only thing these two schemas decide is whether `?onlyActive` was understood.
 *
 * The behaviour worth pinning is the *refusal*: `?onlyActive=yes` has to fail rather
 * than be read as false, because a caller that sent it believes it has excluded the
 * deactivated records and would be shown all of them.
 */

import { describe, expect, it } from 'vitest';

import { chairListQuerySchema, dentistListQuerySchema } from './index.js';

describe.each([
  ['dentistListQuerySchema', dentistListQuerySchema],
  ['chairListQuerySchema', chairListQuerySchema],
] as const)('%s', (_name, schema) => {
  it('reads the flag when it is sent', () => {
    expect(schema.parse({ onlyActive: 'true' }).onlyActive).toBe(true);
    expect(schema.parse({ onlyActive: 'false' }).onlyActive).toBe(false);
  });

  it('leaves it undefined when it is absent, which means no filter', () => {
    // Not `false`. A missing flag that became `false` would be indistinguishable
    // from `?onlyActive=false`, and the two mean the same thing here only by
    // accident of the repository's truthiness check.
    expect(schema.parse({}).onlyActive).toBeUndefined();
  });

  it('refuses a value it would have to guess at', () => {
    expect(schema.safeParse({ onlyActive: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ onlyActive: '1' }).success).toBe(false);
    expect(schema.safeParse({ onlyActive: '' }).success).toBe(false);
    expect(schema.safeParse({ onlyActive: true }).success).toBe(false);
  });
});
