/**
 * Odontogram-entry persistence, on PostgreSQL.
 *
 * The chart has no `clinic_id`, so tenancy comes through the patient and the use
 * case reads the patient in this clinic before it saves (ADR 0014) — the exact
 * notes/discipline. What makes this save different is that it is an **upsert**: a
 * tooth's chart entry is one row keyed on `(patient_id, tooth)`, and the unique
 * index `odontogram_patient_tooth_unique` is what turns a second charting into a
 * replacement rather than a second row. The whole row is replaced — id included —
 * so what the endpoint answered with is exactly what a reader of the chart sees,
 * and nothing else references an entry's id.
 */
import {
  DomainError,
  type OdontogramEntryRecord,
  type OdontogramEntryRepository,
} from '@denti-code-u3/domain';

import { odontogramEntries } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

export class DrizzleOdontogramEntryRepository implements OdontogramEntryRepository {
  constructor(private readonly db: DentiDatabase) {}

  async save(entry: OdontogramEntryRecord): Promise<void> {
    try {
      await this.db
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
        });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${entry.patientId} was not found`, {
          entity: 'Patient',
          id: entry.patientId,
        });
      }
      throw error;
    }
  }
}
