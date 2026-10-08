/**
 * Visit-attachment persistence, on SQLite — the twin of
 * `repositories/visit-attachment-repository.ts` (ADR 0025).
 *
 * The join that scopes `findForVisit` to one clinic, the translated foreign-key
 * refusal in `save`, and the `created_at, id` ordering are the same file: the
 * only differences here are the engine's — the schema entry point, the
 * synchronous `.run()` this driver needs for an insert to happen at all, and
 * `SQLITE_CONSTRAINT_FOREIGNKEY` standing in for PostgreSQL's `23503`.
 */
import {
  DomainError,
  type VisitAttachment,
  type VisitAttachmentRepository,
} from '@denti-code-u3/domain';
import {
  asVisitAttachmentId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { visitAttachments, visits } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

const ATTACHMENT_COLUMNS = {
  id: visitAttachments.id,
  visitId: visitAttachments.visitId,
  fileName: visitAttachments.fileName,
  contentType: visitAttachments.contentType,
  sizeBytes: visitAttachments.sizeBytes,
  createdAt: visitAttachments.createdAt,
} as const;

export class SQLiteVisitAttachmentRepository implements VisitAttachmentRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly VisitAttachment[]> {
    const rows = await this.db
      .select(ATTACHMENT_COLUMNS)
      .from(visitAttachments)
      .innerJoin(visits, eq(visits.id, visitAttachments.visitId))
      .where(and(eq(visitAttachments.visitId, visitId), eq(visits.clinicId, clinicId)))
      .orderBy(asc(visitAttachments.createdAt), asc(visitAttachments.id));

    return rows.map(toEntity);
  }

  async save(attachment: VisitAttachment): Promise<void> {
    try {
      this.db
        .insert(visitAttachments)
        .values({
          id: attachment.id,
          visitId: attachment.visitId,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          createdAt: new Date(attachment.createdAt),
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${attachment.visitId} was not found`, {
          entity: 'Visit',
          id: attachment.visitId,
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
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}): VisitAttachment {
  return {
    id: asVisitAttachmentId(row.id),
    visitId: asVisitId(row.visitId),
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString() as IsoDateTime,
  };
}
