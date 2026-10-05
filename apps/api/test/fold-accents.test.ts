/**
 * The two halves of the accent folding have to agree, and nothing else in the
 * application would notice if they stopped.
 *
 * The `translate()` call in the SQL half is the load-bearing check: PostgreSQL
 * raises `arguments to translate must be equal length` when the `from` and `to`
 * strings differ, so a mistyped alphabet does not quietly return wrong results — it
 * throws. It throws *when a query runs*, though, which in practice means on the
 * patient search or the dentist sort of a deployed clinic. This test moves that
 * failure to `pnpm run test`.
 */

import { describe, expect, it } from 'vitest';

import { foldAccents } from '../src/infrastructure/persistence/postgres/fold-accents.js';

describe('foldAccents', () => {
  it('folds the letters a Spanish-speaking clinic actually records', () => {
    // Every pair here appears in `ACCENTED`/`UNACCENTED`, in both cases.
    expect(foldAccents('Ñuñez')).toBe('nunez');
    expect(foldAccents('García')).toBe('garcia');
    expect(foldAccents('Fernández')).toBe('fernandez');
    expect(foldAccents('Dra. Çeda')).toBe('dra. ceda');
    expect(foldAccents('Ångström')).toBe('angstrom');
    expect(foldAccents('Müller')).toBe('muller');
  });

  it('folds decomposed input the same way as precomposed input', () => {
    // A name arriving from a phone keyboard or a paste is often decomposed, and the
    // two forms must search identically or the same patient is findable by name and
    // not by the other spelling.
    expect(foldAccents('García'.normalize('NFD'))).toBe('garcia');
    expect(foldAccents('Ñuñez'.normalize('NFD'))).toBe('nunez');
  });

  it('lowercases as well as folding', () => {
    // Uppercase accented letters are in the table; folding before lowercasing means
    // one pass covers both, and a mixed-case name must still match.
    expect(foldAccents('MARÍA')).toBe('maria');
    expect(foldAccents('ÉLITE')).toBe('elite');
  });

  it('leaves a name without accents alone apart from its case', () => {
    expect(foldAccents('Vargas')).toBe('vargas');
    expect(foldAccents('Dr. Elena Vargas')).toBe('dr. elena vargas');
  });

  it('survives a name that is nothing but marks and punctuation', () => {
    // The search side folds a term to an empty or odd string before it reaches SQL;
    // this must not throw on the way.
    expect(foldAccents('')).toBe('');
    expect(foldAccents('---')).toBe('---');
    expect(foldAccents('́')).toBe('');
  });
});
