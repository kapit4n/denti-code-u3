/**
 * Dentist persistence, on SQLite — the twin of
 * `repositories/dentist-repository.ts` (ADR 0025).
 *
 * Identical query shapes on the SQLite schema: clinic scope is a parameter, an
 * `is_active` flag is the caller's decision, and the order is by the folded
 * name — the same `translate()` folding both engines run (`fold-accents.ts`).
 */

import type { DentistListRequest, DentistRepository, DentistSummary } from '@denti-code-u3/domain';
import { asDentistId, type ClinicId, type DentistId } from '@denti-code-u3/types';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { dentists } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { sqliteFoldable as foldable } from '../../fold-accents.js';

/** The columns a summary is made of, named once for both queries below. */
const summaryColumns = {
  id: dentists.id,
  userId: dentists.userId,
  fullName: dentists.fullName,
  speciality: dentists.speciality,
  color: dentists.color,
  isActive: dentists.isActive,
} as const;

export class SQLiteDentistRepository implements DentistRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async listByClinic(
    clinicId: ClinicId,
    request: DentistListRequest = {},
  ): Promise<readonly DentistSummary[]> {
    const rows = await this.db
      .select(summaryColumns)
      .from(dentists)
      .where(this.scope(clinicId, request))
      .orderBy(asc(foldable(dentists.fullName)), asc(dentists.id));

    return rows.map(toSummary);
  }

  async findById(clinicId: ClinicId, dentistId: DentistId): Promise<DentistSummary | undefined> {
    const [row] = await this.db
      .select(summaryColumns)
      .from(dentists)
      .where(and(eq(dentists.clinicId, clinicId), eq(dentists.id, dentistId)))
      .limit(1);

    return row ? toSummary(row) : undefined;
  }

  private scope(clinicId: ClinicId, request: DentistListRequest): SQL | undefined {
    return and(
      eq(dentists.clinicId, clinicId),
      request.onlyActive ? eq(dentists.isActive, true) : undefined,
    );
  }
}

function toSummary(row: {
  id: string;
  userId: string | null;
  fullName: string;
  speciality: string | null;
  color: string | null;
  isActive: boolean;
}): DentistSummary {
  return {
    id: asDentistId(row.id),
    userId: row.userId,
    fullName: row.fullName,
    speciality: row.speciality,
    color: row.color,
    isActive: row.isActive,
  };
}
