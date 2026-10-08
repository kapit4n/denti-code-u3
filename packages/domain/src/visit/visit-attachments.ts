/**
 * The files attached to a visit — radiographs, referrals, documents.
 *
 * **An attachment has no clinic of its own, and that is a fact rather than a
 * shortcut.** `visit_attachments` carries `visit_id` and no `clinic_id`, so the
 * visit the attachment names *is* the tenant key. Both use cases therefore read
 * the visit first (ADR 0014), exactly as `clinical-notes.ts` does — everything
 * that file says about why also holds here.
 *
 * **What this book does not do**: store bytes. A `VisitAttachment` is a
 * *reference* to a file — its name, its type, its size — because file storage
 * (local disk, object store, signed URLs) is an open question of its own
 * (`docs/open-questions.md` Q10) and the reference half is what the workspace
 * needs to render first. When storage lands, `bytes`/`url` become a write and a
 * migration, not a redesign.
 *
 * **No `UnitOfWork`**: one row, one statement. Nothing else changes when an
 * attachment is attached.
 */
import type { ClinicId, IsoDateTime, VisitAttachmentId, VisitId } from '@denti-code-u3/types';
import type { Clock } from '../shared/clock.js';
import { DomainError, notFound } from '../shared/errors.js';
import type { VisitAttachmentRepository, VisitRepository } from '../ports/index.js';
import { getVisit } from './visit-read.js';

/**
 * One attached file, as the table holds it.
 *
 * `fileName` is stored trimmed, and never empty — a file the record cannot name
 * is a file the record cannot find. `contentType` and `sizeBytes` are optional
 * because a clinic may know a file exists without having its type or size
 * trusted; when either is given it must be plausible (see `addVisitAttachment`).
 */
export interface VisitAttachment {
  readonly id: VisitAttachmentId;
  readonly visitId: VisitId;
  readonly fileName: string;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
  readonly createdAt: IsoDateTime;
}

/** A read answers with the files a visit holds. */
export interface VisitAttachmentReadDependencies {
  readonly visits: VisitRepository;
  readonly attachments: VisitAttachmentRepository;
}

/** A write adds the two things only a writer knows: whose clock, and what id. */
export interface VisitAttachmentWriteDependencies extends VisitAttachmentReadDependencies {
  readonly clock: Clock;
  readonly newId: () => VisitAttachmentId;
}

/**
 * Every file on one visit, oldest first — the reading order for a record that
 * grows, the same subject-shaped read as `listClinicalNotes`: 404 for a visit
 * this clinic does not hold, `[]` only for a visit that does.
 */
export async function listVisitAttachments(
  clinicId: ClinicId,
  visitId: VisitId,
  dependencies: VisitAttachmentReadDependencies,
): Promise<readonly VisitAttachment[]> {
  await getVisit(clinicId, visitId, { visits: dependencies.visits });

  return dependencies.attachments.findForVisit(clinicId, visitId);
}

/**
 * Attach a file to a visit this clinic holds, and answer with it as written.
 *
 * The clock stamps `createdAt` and the id comes from the caller's generator —
 * the same division of labour every write here has.
 *
 * Two refusals, both `INVALID_INPUT`:
 *  - a file name the record cannot find a file by (blank);
 *  - a negative size, which is a contradiction in the metadata itself.
 * `contentType` is normalized (trimmed, lower-cased) and an empty one is stored
 * as `null` rather than kept — an empty MIME type is a lie, not metadata.
 */
export async function addVisitAttachment(
  clinicId: ClinicId,
  visitId: VisitId,
  fileName: string,
  contentType: string | null,
  sizeBytes: number | null,
  dependencies: VisitAttachmentWriteDependencies,
): Promise<VisitAttachment> {
  const visit = await dependencies.visits.findById(clinicId, visitId);

  if (!visit) {
    throw notFound('Visit', visitId);
  }

  const name = fileName.trim();

  if (!name) {
    throw new DomainError('INVALID_INPUT', 'A file needs a name', { visitId });
  }

  if (sizeBytes !== null && sizeBytes < 0) {
    throw new DomainError('INVALID_INPUT', 'A file size cannot be negative', { sizeBytes });
  }

  const type = contentType?.trim().toLowerCase() || null;

  const attachment: VisitAttachment = {
    id: dependencies.newId(),
    visitId,
    fileName: name,
    contentType: type,
    sizeBytes,
    createdAt: dependencies.clock.now(),
  };

  await dependencies.attachments.save(attachment);

  return attachment;
}
