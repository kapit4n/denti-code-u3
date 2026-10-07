/**
 * Clinical-note persistence, on SQLite — the twin of
 * `repositories/clinical-note-repository.ts` (ADR 0025).
 *
 * The join that scopes `findForVisit` to one clinic, the translated foreign-key
 * refusal in `save`, and the `created_at, id` ordering are the same file: the only
 * differences here are the engine's — the schema entry point, the synchronous `.run()`
 * this driver needs for an insert to happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY`
 * standing in for PostgreSQL's `23503`.
 */
import { DomainError, type ClinicalNote, type ClinicalNoteRepository } from '@denti-code-u3/domain';
import {
  asClinicalNoteId,
  asUserId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { clinicalNotes, visits } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

const NOTE_COLUMNS = {
  id: clinicalNotes.id,
  visitId: clinicalNotes.visitId,
  authorId: clinicalNotes.authorId,
  body: clinicalNotes.body,
  createdAt: clinicalNotes.createdAt,
} as const;

export class SQLiteClinicalNoteRepository implements ClinicalNoteRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly ClinicalNote[]> {
    const rows = await this.db
      .select(NOTE_COLUMNS)
      .from(clinicalNotes)
      .innerJoin(visits, eq(visits.id, clinicalNotes.visitId))
      .where(and(eq(clinicalNotes.visitId, visitId), eq(visits.clinicId, clinicId)))
      .orderBy(asc(clinicalNotes.createdAt), asc(clinicalNotes.id));

    return rows.map(toEntity);
  }

  async save(note: ClinicalNote): Promise<void> {
    try {
      this.db
        .insert(clinicalNotes)
        .values({
          id: note.id,
          visitId: note.visitId,
          authorId: note.authorId,
          body: note.body,
          createdAt: new Date(note.createdAt),
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${note.visitId} was not found`, {
          entity: 'Visit',
          id: note.visitId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }
}

function toEntity(row: {
  id: string;
  visitId: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
}): ClinicalNote {
  return {
    id: asClinicalNoteId(row.id),
    visitId: asVisitId(row.visitId),
    authorId: row.authorId ? asUserId(row.authorId) : null,
    body: row.body,
    createdAt: row.createdAt.toISOString() as IsoDateTime,
  };
}
