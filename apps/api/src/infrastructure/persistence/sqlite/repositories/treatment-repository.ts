/**
 * Treatment-catalogue persistence, on SQLite — the twin of
 * `repositories/treatment-repository.ts` (ADR 0025).
 *
 * The kit is the same file in every way that matters: the tenant-scoped select from a
 * table that genuinely carries `clinic_id`, the `name, id` ordering, and the single-row
 * `findById`. The differences are the engine's — the schema entry point and the
 * synchronous reads this driver needs.
 */
import { type TreatmentCatalogueItem, type TreatmentRepository } from '@denti-code-u3/domain';
import { asTreatmentId, type ClinicId, type TreatmentId } from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { treatments } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';

const CATALOGUE_COLUMNS = {
  id: treatments.id,
  code: treatments.code,
  name: treatments.name,
  description: treatments.description,
  defaultDurationMinutes: treatments.defaultDurationMinutes,
  defaultPriceMinor: treatments.defaultPriceMinor,
  isActive: treatments.isActive,
} as const;

export class SQLiteTreatmentRepository implements TreatmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async listByClinic(clinicId: ClinicId): Promise<readonly TreatmentCatalogueItem[]> {
    const rows = this.db
      .select(CATALOGUE_COLUMNS)
      .from(treatments)
      .where(eq(treatments.clinicId, clinicId))
      .orderBy(asc(treatments.name), asc(treatments.id));

    return rows.all().map(toItem);
  }

  async findById(
    clinicId: ClinicId,
    treatmentId: TreatmentId,
  ): Promise<TreatmentCatalogueItem | undefined> {
    const row = this.db
      .select(CATALOGUE_COLUMNS)
      .from(treatments)
      .where(and(eq(treatments.clinicId, clinicId), eq(treatments.id, treatmentId)))
      .get();

    return row ? toItem(row) : undefined;
  }
}

function toItem(row: {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  defaultDurationMinutes: number | null;
  defaultPriceMinor: number;
  isActive: boolean;
}): TreatmentCatalogueItem {
  return {
    id: asTreatmentId(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    defaultDurationMinutes: row.defaultDurationMinutes,
    defaultPriceMinor: row.defaultPriceMinor,
    isActive: row.isActive,
  };
}
