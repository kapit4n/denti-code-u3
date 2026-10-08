/**
 * Odontogram-entry persistence, on SQLite — the twin of
 * `repositories/odontogram-entry-repository.ts` (ADR 0025).
 *
 * The upsert is the same file, and the engine's differences are only the ones a
 * twin always has: the schema entry point, the synchronous `.run()` this driver
 * needs for a write to happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY` standing
 * in for PostgreSQL's `23503`. The unique index that turns a second charting into
 * a replacement is `odontogram_patient_tooth_unique`, on both engines (ADR 0025),
 * and SQLite's `ON CONFLICT … DO UPDATE` is the same arbitration PostgreSQL's is.
 */
import {
  DomainError,
  type OdontogramEntryRecord,
  type OdontogramEntryRepository,
} from '@denti-code-u3/domain';

import { odontogramEntries } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

export class SQLiteOdontogramEntryRepository implements OdontogramEntryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(entry: OdontogramEntryRecord): Promise<void> {
    try {
      this.db
        .insert(odontogramEntries)
        .values({
          id: entry.id,
          patientId: entry.patientId,
          visitId: entry.visitId,
          dentition: entry.dentition,
          tooth: entry.tooth,
          surfaces: [...entry.surfaces],
          condition: entry.condition,
          notes: entry.notes,
          recordedBy: null,
          recordedAt: new Date(entry.recordedAt),
        })
        .onConflictDoUpdate({
          target: [odontogramEntries.patientId, odontogramEntries.tooth],
          set: {
            id: entry.id,
            patientId: entry.patientId,
            visitId: entry.visitId,
            dentition: entry.dentition,
            tooth: entry.tooth,
            surfaces: [...entry.surfaces],
            condition: entry.condition,
            notes: entry.notes,
            recordedBy: null,
            recordedAt: new Date(entry.recordedAt),
          },
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${entry.patientId} was not found`, {
          entity: 'Patient',
          id: entry.patientId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }
}
