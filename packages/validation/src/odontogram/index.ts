/**
 * Odontogram boundary schemas.
 *
 * `POST /api/v1/patients/:patientId/odontogram/entries` charts one tooth. The body
 * is only the clinical finding — the tooth, its condition and its surfaces — for
 * the same reason the visit-books' bodies are only their courses: **the subject is
 * the patient on the path, the dentition is a fact about the tooth number, the id
 * and the clock are the server's** (ADR 0014). A patient this clinic does not hold
 * answers 404 whether the finding is well formed or not; a finding that cannot be a
 * finding is refused here.
 *
 * The condition and surface lists are mirrored from the domain enum's values, the
 * same mirror as `medicationRouteSchema` (ADR 0011): this package holds no domain
 * dependency, so the two copies are kept aligned by the write path typing the body
 * with the domain's types and by the database's own `enumCheck` guarding the column.
 */

import { z } from 'zod';

/** Every possible condition of a tooth, mirrored from the domain enum's values. */
export const odontogramConditionSchema = z.enum([
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
]);

/** Every surface a tooth has, mirrored from the domain enum's values. */
export const odontogramSurfaceSchema = z.enum([
  'MESIAL',
  'DISTAL',
  'BUCCAL',
  'LINGUAL',
  'OCCLUSAL',
  'INCISAL',
]);

/**
 * Chart (or re-chart) one tooth of a patient.
 *
 * `tooth` is an FDI two-digit number — quadrant then position, `11`–`48` for
 * permanent teeth and `51`–`85` for primary — checked here so a body that is not a
 * tooth is refused with its own sentence rather than reaching the domain to fail a
 * number test. `dentition` is deliberately not in the body: it is a fact about the
 * number, and a client that could state it could state it differently.
 *
 * `surfaces` may be empty, because whether "no surfaces" is a legal finding is the
 * domain's whole-tooth judgement (`HEALTHY` needs none, `CARIES` needs one) and no
 * boundary schema can see the condition it was given and the read it was given in
 * the same breath. `condition` is the one field that must always be stated.
 */
export const createOdontogramEntrySchema = z.object({
  tooth: z
    .string()
    .trim()
    .regex(/^([1-4][1-8]|[5-8][1-5])$/, 'A tooth is an FDI number, like "36" or "75"'),
  condition: odontogramConditionSchema,
  surfaces: z.array(odontogramSurfaceSchema).max(6, 'A tooth has at most six surfaces'),
  notes: z.string().trim().max(2_000, 'The notes are too long').optional().nullable(),
});

export type CreateOdontogramEntryInput = z.infer<typeof createOdontogramEntrySchema>;

/**
 * Deliberately absent: a `dentitionSchema` mirror, and the reason is the schema's
 * own. Dentition is derivable from the tooth and the chart never accepts one, so a
 * mirror would be a value that appears on no request — a mirror with nothing keeping
 * it honest, exactly like the absent visit-status mirror in `visits/index.ts`.
 */
