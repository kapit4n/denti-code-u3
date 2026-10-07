/**
 * Clinical-note persistence, on PostgreSQL.
 *
 * The whole file exists because `clinical_notes` has no `clinic_id`, and every line
 * below follows from that one fact:
 *
 *  - **`findForVisit` takes a clinic and joins `visits` to use it.** A read has no use
 *    case in front of it to resolve the visit first (the repository *is* the read), so
 *    the scoping has to live in the statement — a note row on its own cannot tell
 *    which clinic owns it (ADR 0014).
 *  - **`save` takes no clinic, because the use case already read the visit in this
 *    clinic.** What `save` cannot know is whether that visit still exists, so the one
 *    refusal it translates is the foreign key: a visit deleted between the read and
 *    the insert answers `NOT_FOUND` rather than a `23503` reaching the API as a 500.
 *
 * Order is `created_at` ascending with the id as a tiebreak: two notes filed in the
 * same millisecond still have a stable reading order, and a clinical record that
 * shuffles between reads is worse than one with an arbitrary-but-fixed order.
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

import { clinicalNotes, visits } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

const NOTE_COLUMNS = {
  id: clinicalNotes.id,
  visitId: clinicalNotes.visitId,
  authorId: clinicalNotes.authorId,
  body: clinicalNotes.body,
  createdAt: clinicalNotes.createdAt,
} as const;

export class DrizzleClinicalNoteRepository implements ClinicalNoteRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      await this.db.insert(clinicalNotes).values({
        id: note.id,
        visitId: note.visitId,
        authorId: note.authorId,
        body: note.body,
        createdAt: new Date(note.createdAt),
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${note.visitId} was not found`, {
          entity: 'Visit',
          id: note.visitId,
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
    // Null is a fact about the row, not an absent field: there is no user model to
    // attribute a note to yet (ADR 0022), and dropping the key would make "nobody
    // attributed" indistinguishable from "this build does not read attribution".
    authorId: row.authorId ? asUserId(row.authorId) : null,
    body: row.body,
    createdAt: row.createdAt.toISOString() as IsoDateTime,
  };
}
