import { describe, expect, it } from 'vitest';
import {
  assertValidOdontogramEntry,
  dentitionForTooth,
  isSurfaceApplicable,
  isValidPermanentTooth,
  isValidPrimaryTooth,
  odontogramEntryKey,
  teethOfDentition,
  type OdontogramEntry,
} from './odontogram.js';
import { DomainError } from '../shared/errors.js';
import { asPatientId, asVisitId } from '@denti-code-u3/types';

const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const VISIT = asVisitId('22222222-2222-4222-8222-222222222222');

describe('FDI tooth numbers', () => {
  it('recognises permanent teeth 11..48', () => {
    expect(isValidPermanentTooth('11')).toBe(true);
    expect(isValidPermanentTooth('16')).toBe(true);
    expect(isValidPermanentTooth('48')).toBe(true);
    expect(isValidPermanentTooth('51')).toBe(false);
  });

  it('recognises primary teeth 51..85', () => {
    expect(isValidPrimaryTooth('51')).toBe(true);
    expect(isValidPrimaryTooth('85')).toBe(true);
    expect(isValidPrimaryTooth('55')).toBe(true);
    expect(isValidPrimaryTooth('11')).toBe(false);
  });

  it('infers the dentition from the tooth number', () => {
    expect(dentitionForTooth('16')).toBe('PERMANENT');
    expect(dentitionForTooth('54')).toBe('PRIMARY');
  });

  it('throws for a tooth number that does not exist', () => {
    expect(() => dentitionForTooth('99')).toThrow(DomainError);
  });

  it('enumerates every tooth of a dentition exactly once', () => {
    const permanent = teethOfDentition('PERMANENT');
    const primary = teethOfDentition('PRIMARY');

    expect(permanent).toHaveLength(32);
    expect(primary).toHaveLength(20);
    expect(new Set(permanent).size).toBe(32);
    expect(new Set(primary).size).toBe(20);
  });
});

describe('isSurfaceApplicable', () => {
  it('allows an incisal surface only on an anterior permanent tooth', () => {
    expect(isSurfaceApplicable('INCISAL', 'PERMANENT', '11')).toBe(true);
    expect(isSurfaceApplicable('INCISAL', 'PERMANENT', '16')).toBe(false);
    expect(isSurfaceApplicable('INCISAL', 'PRIMARY', '51')).toBe(false);
  });

  it('allows an occlusal surface only from the premolar onwards', () => {
    expect(isSurfaceApplicable('OCCLUSAL', 'PERMANENT', '16')).toBe(true);
    expect(isSurfaceApplicable('OCCLUSAL', 'PERMANENT', '14')).toBe(true);
    expect(isSurfaceApplicable('OCCLUSAL', 'PERMANENT', '13')).toBe(false);
    expect(isSurfaceApplicable('OCCLUSAL', 'PRIMARY', '54')).toBe(true);
  });

  it('allows mesial, distal, buccal and lingual everywhere', () => {
    for (const surface of ['MESIAL', 'DISTAL', 'BUCCAL', 'LINGUAL'] as const) {
      expect(isSurfaceApplicable(surface, 'PERMANENT', '11')).toBe(true);
      expect(isSurfaceApplicable(surface, 'PRIMARY', '51')).toBe(true);
    }
  });
});

describe('assertValidOdontogramEntry', () => {
  const base: OdontogramEntry = {
    id: 'entry-1',
    patientId: PATIENT,
    visitId: VISIT,
    dentition: 'PERMANENT',
    tooth: '16',
    surfaces: ['OCCLUSAL'],
    condition: 'CARIES',
  };

  it('accepts a surface-limited finding', () => {
    expect(() => assertValidOdontogramEntry(base)).not.toThrow();
  });

  it('accepts a whole-tooth condition without surfaces', () => {
    expect(() =>
      assertValidOdontogramEntry({ ...base, surfaces: [], condition: 'ROOT_CANAL' }),
    ).not.toThrow();
  });

  it('rejects a finding with neither a surface nor a whole-tooth condition', () => {
    expect(() =>
      assertValidOdontogramEntry({ ...base, surfaces: [], condition: 'CARIES' }),
    ).toThrow(DomainError);
  });

  it('rejects a tooth that is not part of the declared dentition', () => {
    expect(() => assertValidOdontogramEntry({ ...base, dentition: 'PRIMARY' })).toThrow(
      DomainError,
    );
  });
});

describe('odontogramEntryKey', () => {
  it('scopes the natural key to patient, dentition and tooth', () => {
    expect(odontogramEntryKey(PATIENT, 'PERMANENT', '16')).toBe(`${PATIENT}:PERMANENT:16`);
    expect(odontogramEntryKey(PATIENT, 'PRIMARY', '16')).toBe(`${PATIENT}:PRIMARY:16`);
  });
});
