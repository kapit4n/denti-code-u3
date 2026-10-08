import { describe, expect, it } from 'vitest';
import {
  createOdontogramEntrySchema,
  odontogramConditionSchema,
  odontogramSurfaceSchema,
} from './index.js';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';

describe('createOdontogramEntrySchema', () => {
  it('accepts a permanent tooth with its condition and surfaces, trimming the tooth', () => {
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '  16  ',
      condition: 'CARIES',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      notes: '  Patch visible on the film.  ',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      tooth: '16',
      condition: 'CARIES',
      surfaces: ['MESIAL', 'OCCLUSAL'],
      notes: 'Patch visible on the film.',
    });
  });

  it('accepts a primary tooth and a whole-tooth condition with no surfaces', () => {
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '75',
      condition: 'CROWN',
      surfaces: [],
      notes: null,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ tooth: '75', condition: 'CROWN', surfaces: [], notes: null });
  });

  it('leaves a missing note out of what the domain receives', () => {
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '36',
      condition: 'HEALTHY',
      surfaces: [],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ tooth: '36', condition: 'HEALTHY', surfaces: [] });
  });

  it('refuses a tooth that is not an FDI number', () => {
    for (const tooth of ['99', '0', '1', '09', '123', 'abc', '  16x']) {
      expect(
        createOdontogramEntrySchema.safeParse({ tooth, condition: 'HEALTHY', surfaces: [] })
          .success,
      ).toBe(false);
    }
  });

  it('refuses a blank tooth', () => {
    expect(
      createOdontogramEntrySchema.safeParse({ tooth: '   ', condition: 'HEALTHY', surfaces: [] })
        .success,
    ).toBe(false);
  });

  it('refuses a condition the chart does not know', () => {
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '16',
      condition: 'BRACED',
      surfaces: [],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['condition']);
  });

  it('refuses a surface the chart does not know', () => {
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '16',
      condition: 'CARIES',
      surfaces: ['PALATAL'],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.slice(0, 1)).toEqual(['surfaces']);
  });

  it('refuses more surfaces than a tooth has', () => {
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '16',
      condition: 'CARIES',
      surfaces: ['MESIAL', 'DISTAL', 'BUCCAL', 'LINGUAL', 'OCCLUSAL', 'INCISAL', 'MESIAL'],
    });

    expect(result.success).toBe(false);
  });

  it('refuses notes beyond the clinical-note ceiling', () => {
    expect(
      createOdontogramEntrySchema.safeParse({
        tooth: '16',
        condition: 'CARIES',
        surfaces: ['MESIAL'],
        notes: 'x'.repeat(2_001),
      }).success,
    ).toBe(false);
  });

  it('drops who the chart belongs to and whose clock it carries, which are the server’s', () => {
    // patientId is the path, the dentition is a fact about the tooth number, and the
    // id and the timestamp are the server's (ADR 0014).
    const result = createOdontogramEntrySchema.safeParse({
      tooth: '16',
      condition: 'CARIES',
      surfaces: ['MESIAL'],
      patientId: PATIENT_ID,
      dentition: 'DECIDUOUS',
      id: '99999999-9999-4999-8999-999999999999',
      recordedAt: '2020-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ tooth: '16', condition: 'CARIES', surfaces: ['MESIAL'] });
  });
});

describe('odontogram mirror enums', () => {
  it('mirrors every condition the domain can store', () => {
    const conditions = [
      'HEALTHY',
      'CARIES',
      'FILLED',
      'MISSING',
      'CROWN',
      'IMPLANT',
      'ROOT_CANAL',
      'EXTRACTION_INDICATED',
      'EXTRACTED',
      'SEALANT',
      'VENEER',
      'FRACTURE',
      'MOBILITY',
      'PROSTHESIS',
    ];

    expect(odontogramConditionSchema.options).toEqual(conditions);
  });

  it('mirrors every surface a tooth can have', () => {
    expect(odontogramSurfaceSchema.options).toEqual([
      'MESIAL',
      'DISTAL',
      'BUCCAL',
      'LINGUAL',
      'OCCLUSAL',
      'INCISAL',
    ]);
  });
});
