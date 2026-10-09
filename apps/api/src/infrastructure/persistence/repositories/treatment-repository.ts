/**
 * Treatment-catalogue persistence, on PostgreSQL.
 *
 * The catalogue is scoped by the tenant in every statement, because unlike a record it
 * *has* the tenant: `treatments.clinic_id` is a real column, and nothing below needs a
 * join to read it.
 *
 * Ordering is `name` with the id as a tiebreak, the order a picker reads a catalogue in
 * — two rows may share a name (a clinic and its branch, or a grandfathered spelling),
 * and an arbitrary-but-fixed order is better than one that shuffles between reads.
 */
import {
  DomainError,
  type TreatmentCatalogueItem,
  type TreatmentRepository,
} from '@denti-code-u3/domain';
import { asTreatmentId, type ClinicId, type TreatmentId } from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { treatments } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isUniqueViolation } from '../postgres-error.js';

const CATALOGUE_COLUMNS = {
  id: treatments.id,
  code: treatments.code,
  name: treatments.name,
  description: treatments.description,
  defaultDurationMinutes: treatments.defaultDurationMinutes,
  defaultPriceMinor: treatments.defaultPriceMinor,
  isActive: treatments.isActive,
} as const;

export class DrizzleTreatmentRepository implements TreatmentRepository {
  constructor(private readonly db: DentiDatabase) {}

  async listByClinic(clinicId: ClinicId): Promise<readonly TreatmentCatalogueItem[]> {
    const rows = await this.db
      .select(CATALOGUE_COLUMNS)
      .from(treatments)
      .where(eq(treatments.clinicId, clinicId))
      .orderBy(asc(treatments.name), asc(treatments.id));

    return rows.map(toItem);
  }

  async findById(
    clinicId: ClinicId,
    treatmentId: TreatmentId,
  ): Promise<TreatmentCatalogueItem | undefined> {
    const [row] = await this.db
      .select(CATALOGUE_COLUMNS)
      .from(treatments)
      .where(and(eq(treatments.clinicId, clinicId), eq(treatments.id, treatmentId)))
      .limit(1);

    return row ? toItem(row) : undefined;
  }

  async add(clinicId: ClinicId, item: TreatmentCatalogueItem): Promise<void> {
    try {
      await this.db.insert(treatments).values({
        id: item.id,
        clinicId,
        code: item.code,
        name: item.name,
        description: item.description,
        defaultDurationMinutes: item.defaultDurationMinutes,
        defaultPriceMinor: item.defaultPriceMinor,
        isActive: item.isActive,
      });
    } catch (error) {
      // The unique index on (clinic_id, code) is where the "already in the
      // catalogue" rule lives — the only place two concurrent writers are both
      // visible. Translating it keeps the catalogue's most common mistake a 409
      // the caller is told about, in both engines. `created_at` and `updated_at`
      // are the row's own bookkeeping, defaulted by the database.
      if (isUniqueViolation(error)) {
        throw new DomainError('DUPLICATED_RECORD', 'That code is already in the catalogue', {
          field: 'code',
        });
      }
      throw error;
    }
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
