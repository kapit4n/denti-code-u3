/**
 * Odontogram: the per-tooth clinical map of a patient.
 *
 * Notation is FDI (two-digit): quadrant 1–8 upper right → upper left, 1–8 lower
 * left → lower right for permanent teeth; 1–8 and 5–8 for primary teeth. FDI is
 * used because it is unambiguous across countries and names quadrants directly.
 */

import type { PatientId, VisitId } from '@denti-code-u3/types';
import { DomainError } from '../shared/errors.js';

export const DENTITIONS = ['PERMANENT', 'PRIMARY', 'MIXED'] as const;

export type Dentition = (typeof DENTITIONS)[number];

export const ODONTOGRAM_CONDITIONS = [
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
] as const;

export type OdontogramCondition = (typeof ODONTOGRAM_CONDITIONS)[number];

export const ODONTOGRAM_SURFACES = [
  'MESIAL',
  'DISTAL',
  'BUCCAL',
  'LINGUAL',
  'OCCLUSAL',
  'INCISAL',
] as const;

export type OdontogramSurface = (typeof ODONTOGRAM_SURFACES)[number];

export interface OdontogramEntry {
  readonly id: string;
  readonly patientId: PatientId;
  readonly visitId?: VisitId;
  readonly dentition: Dentition;
  /** FDI tooth number as a string, e.g. `"16"` or `"51"`. */
  readonly tooth: string;
  readonly surfaces: readonly OdontogramSurface[];
  readonly condition: OdontogramCondition;
  readonly notes?: string;
}

/**
 * FDI quadrants: permanent teeth occupy quadrants 1-4 (`11`..`48`) with eight
 * positions each; primary teeth occupy quadrants 5-8 (`51`..`85`) with five
 * positions each.
 */
const PERMANENT_TOOTH_PATTERN = /^([1-4])([1-8])$/;
const PRIMARY_TOOTH_PATTERN = /^([5-8])([1-5])$/;

export function isValidPermanentTooth(tooth: string): boolean {
  return PERMANENT_TOOTH_PATTERN.test(tooth);
}

export function isValidPrimaryTooth(tooth: string): boolean {
  return PRIMARY_TOOTH_PATTERN.test(tooth);
}

export function dentitionForTooth(tooth: string): Dentition {
  if (isValidPrimaryTooth(tooth)) {
    return 'PRIMARY';
  }
  if (isValidPermanentTooth(tooth)) {
    return 'PERMANENT';
  }
  throw new DomainError('INVALID_INPUT', `"${tooth}" is not a valid FDI tooth number`, { tooth });
}

/** Every FDI tooth number of a dentition, in quadrant order. */
export function teethOfDentition(dentition: Dentition): readonly string[] {
  if (dentition === 'MIXED') {
    return [...teethOfDentition('PRIMARY'), ...teethOfDentition('PERMANENT')];
  }
  const permanent = dentition === 'PERMANENT';
  const firstQuadrant = permanent ? 1 : 5;
  const positionCount = permanent ? 8 : 5;
  return [0, 1, 2, 3].flatMap((quadrant) =>
    Array.from({ length: positionCount }, (_, index) => `${firstQuadrant + quadrant}${index + 1}`),
  );
}

export function assertValidTooth(dentition: Dentition, tooth: string): void {
  if (!teethOfDentition(dentition).includes(tooth)) {
    throw new DomainError('INVALID_INPUT', `Tooth ${tooth} is not part of ${dentition} dentition`, {
      dentition,
      tooth,
    });
  }
}

/** `patientId + dentition + tooth` is the natural key of an odontogram. */
export function odontogramEntryKey(
  patientId: PatientId,
  dentition: Dentition,
  tooth: string,
): string {
  return `${patientId}:${dentition}:${tooth}`;
}

/**
 * `true` when a surface is anatomically meaningful for a tooth.
 *
 * Incisors and canines have an incisal edge rather than an occlusal surface, so
 * `OCCLUSAL` only applies from the premolar (position 4) onwards, and
 * `INCISAL` only applies up to the canine (position 3).
 */
export function isSurfaceApplicable(
  surface: OdontogramSurface,
  dentition: Dentition,
  tooth: string,
): boolean {
  assertValidTooth(dentition, tooth);
  const position = Number(tooth.slice(1));
  const isPrimary = dentition === 'PRIMARY';
  if (surface === 'OCCLUSAL') {
    return position >= 4;
  }
  if (surface === 'INCISAL') {
    return !isPrimary && position <= 3;
  }
  return true;
}

/**
 * Conditions that describe the whole tooth and therefore need no surface.
 * Everything else describes a site, so it must name at least one surface.
 */
export const WHOLE_TOOTH_CONDITIONS = [
  'HEALTHY',
  'MISSING',
  'ROOT_CANAL',
  'CROWN',
  'IMPLANT',
  'EXTRACTED',
  'VENEER',
  'PROSTHESIS',
  'MOBILITY',
  'SEALANT',
] as const satisfies readonly OdontogramCondition[];

export function isWholeToothCondition(condition: OdontogramCondition): boolean {
  return (WHOLE_TOOTH_CONDITIONS as readonly string[]).includes(condition);
}

export function assertValidOdontogramEntry(entry: OdontogramEntry): void {
  assertValidTooth(entry.dentition, entry.tooth);
  for (const surface of entry.surfaces) {
    if (!isSurfaceApplicable(surface, entry.dentition, entry.tooth)) {
      throw new DomainError(
        'INVALID_INPUT',
        `Surface ${surface} does not apply to tooth ${entry.tooth}`,
        { tooth: entry.tooth, dentition: entry.dentition, surface },
      );
    }
  }
  if (entry.surfaces.length === 0 && !isWholeToothCondition(entry.condition)) {
    throw new DomainError(
      'INVALID_INPUT',
      'A finding must affect at least one surface, or describe the whole tooth',
      { tooth: entry.tooth, condition: entry.condition },
    );
  }
}
