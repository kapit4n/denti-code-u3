/**
 * Visit-attachment persistence, on PostgreSQL.
 *
 * The twin argument of `clinical-note-repository.ts`, row for row: attachments
 * have no `clinic_id`, so `findForVisit` joins `visits` to scope and `save`
 * translates the foreign-key refusal and leaves scoping to the use case that
 * already read the visit (ADR 0014). Order is `created_at` ascending with the id
 * as a tiebreak, the reading order a clinical record expects.
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

import { visitAttachments, visits } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

const ATTACHMENT_COLUMNS = {
  id: visitAttachments.id,
  visitId: visitAttachments.visitId,
  fileName: visitAttachments.fileName,
  contentType: visitAttachments.contentType,
  sizeBytes: visitAttachments.sizeBytes,
  createdAt: visitAttachments.createdAt,
} as const;

export class DrizzleVisitAttachmentRepository implements VisitAttachmentRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      await this.db.insert(visitAttachments).values({
        id: attachment.id,
        visitId: attachment.visitId,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        createdAt: new Date(attachment.createdAt),
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${attachment.visitId} was not found`, {
          entity: 'Visit',
          id: attachment.visitId,
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
