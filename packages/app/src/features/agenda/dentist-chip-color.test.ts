/**
 * Tests for the chip colour rule.
 *
 * The cases that matter are the ones a hostile or careless value in a `text` column
 * would produce. A permissive rule here is an inline-style injection, and the
 * failure is invisible in every other test: the chips render fine, the grid renders
 * fine, and the browser does something the clinic did not ask for.
 */

import { describe, expect, it } from 'vitest';

import { dentistChipColor } from './dentist-chip-color.js';

describe('dentistChipColor', () => {
  it('passes the two hex shapes through', () => {
    expect(dentistChipColor('#0ea5e9')).toBe('#0ea5e9');
    expect(dentistChipColor('#FFF')).toBe('#FFF');
  });

  it('ignores surrounding whitespace, because a column may hold it', () => {
    expect(dentistChipColor('  #0ea5e9 ')).toBe('#0ea5e9');
  });

  it('refuses a CSS keyword, which is not a hex triplet', () => {
    // `red` and `chartreuse` are valid CSS colours and invalid hex. Accepting them
    // would mean accepting any word the browser knows, which is a second language to
    // validate against rather than one shape.
    expect(dentistChipColor('red')).toBeUndefined();
  });

  it('refuses a value that is not a colour at all', () => {
    expect(dentistChipColor('not a colour')).toBeUndefined();
    expect(
      dentistChipColor('#0ea5e9; background-image: url(https://elsewhere.test/x)'),
    ).toBeUndefined();
  });

  it('refuses shapes that merely start with a hash', () => {
    expect(dentistChipColor('#')).toBeUndefined();
    expect(dentistChipColor('#12345')).toBeUndefined();
    expect(dentistChipColor('#1234567')).toBeUndefined();
    expect(dentistChipColor('#0ea5e9z')).toBeUndefined();
  });

  it('has no answer for a clinician with no colour recorded', () => {
    expect(dentistChipColor(null)).toBeUndefined();
    expect(dentistChipColor(undefined)).toBeUndefined();
    expect(dentistChipColor('')).toBeUndefined();
  });
});
