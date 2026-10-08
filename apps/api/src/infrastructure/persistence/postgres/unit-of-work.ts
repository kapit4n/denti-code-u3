/**
 * The transaction boundary, on PostgreSQL.
 *
 * The domain declared `UnitOfWork` in Milestone 1 and nothing implemented it, because
 * no use case needed one: every write so far touched a single row. Starting a visit
 * was the first that did not — it writes a `visits` row *and* moves its `appointments`
 * row — and the declaration's own comment said as much: "a use case that must write
 * several rows atomically receives a `UnitOfWork`" (ADR 0021).
 *
 * **The repositories are built per transaction, not shared.** A repository holds the
 * database handle it was constructed with, so reusing one outside a transaction would
 * quietly write outside it — the exact bug the seam exists to prevent, wearing the
 * shape of correct code. `new DrizzleAppointmentRepository(tx)` costs an object
 * allocation and buys the guarantee that no repository in here can escape its
 * transaction.
 *
 * **The set is built fresh rather than passed in,** because the alternative is a
 * `Repositories` object assembled once from the outer connection and then handed to
 * every callback, and that object would hold the wrong handles. The cost is that each
 * transaction constructs ten wrappers, which is nothing next to the round trip it is
 * about to make.
 */
import type { Repositories, UnitOfWork } from '@denti-code-u3/domain';

import type { DentiDatabase } from './connection.js';
import { DrizzleAppointmentRepository } from '../repositories/appointment-repository.js';
import { DrizzleChairRepository } from '../repositories/chair-repository.js';
import { DrizzleChargeRepository } from '../repositories/charge-repository.js';
import { DrizzleClinicalNoteRepository } from '../repositories/clinical-note-repository.js';
import { DrizzleClinicRepository } from '../repositories/clinic-repository.js';
import { DrizzleDentistRepository } from '../repositories/dentist-repository.js';
import { DrizzlePatientRepository } from '../repositories/patient-repository.js';
import { DrizzlePrescriptionRepository } from '../repositories/prescription-repository.js';
import { DrizzleTreatmentRecordRepository } from '../repositories/treatment-record-repository.js';
import { DrizzleTreatmentRepository } from '../repositories/treatment-repository.js';
import { DrizzleVisitRepository } from '../repositories/visit-repository.js';

/**
 * One repository per port, all on the same handle.
 *
 * Exported because the API wires routes with repositories built on the outer
 * connection, and a caller that needed both would otherwise construct ten twice.
 */
export function repositoriesFor(db: DentiDatabase): Repositories {
  return {
    patients: new DrizzlePatientRepository(db),
    appointments: new DrizzleAppointmentRepository(db),
    visits: new DrizzleVisitRepository(db),
    clinicalNotes: new DrizzleClinicalNoteRepository(db),
    prescriptions: new DrizzlePrescriptionRepository(db),
    charges: new DrizzleChargeRepository(db),
    treatments: new DrizzleTreatmentRepository(db),
    treatmentRecords: new DrizzleTreatmentRecordRepository(db),
    clinics: new DrizzleClinicRepository(db),
    dentists: new DrizzleDentistRepository(db),
    chairs: new DrizzleChairRepository(db),
  };
}

/**
 * A `UnitOfWork` whose transactions are PostgreSQL transactions.
 *
 * `db.transaction` rolls back when the callback throws, which is what makes the
 * use case's refusals safe: a `DomainError` raised halfway through the bridge leaves
 * no visit and no appointment moved, rather than the half-written state this seam was
 * introduced to prevent.
 *
 * Note what is *not* here: no retry. A serialization failure or a deadlock is left to
 * propagate, because retrying a transaction that contains a domain refusal would
 * re-run the rules and could answer differently, and this codebase's answers are meant
 * to be reproducible.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: DentiDatabase) {}

  async transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(repositoriesFor(tx as DentiDatabase)));
  }
}
