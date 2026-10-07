/**
 * One SQLite repository per port (ADR 0025).
 *
 * The SQLite twin of `postgres/unit-of-work.ts`'s `repositoriesFor`. It builds
 * every repository on one SQLite handle; the connection assembles the outer
 * set and each transaction builds its own through the same function, so a
 * repository built on the outer connection can never escape into a
 * transaction.
 */

import type { Repositories } from '@denti-code-u3/domain';

import type { SqliteDatabase } from './connection.js';
import { SQLiteAppointmentRepository } from './repositories/appointment-repository.js';
import { SQLiteChairRepository } from './repositories/chair-repository.js';
import { SQLiteClinicalNoteRepository } from './repositories/clinical-note-repository.js';
import { SQLiteClinicRepository } from './repositories/clinic-repository.js';
import { SQLiteDentistRepository } from './repositories/dentist-repository.js';
import { SQLitePatientRepository } from './repositories/patient-repository.js';
import { SQLiteTreatmentRecordRepository } from './repositories/treatment-record-repository.js';
import { SQLiteTreatmentRepository } from './repositories/treatment-repository.js';
import { SQLiteVisitRepository } from './repositories/visit-repository.js';

export function sqliteRepositoriesFor(db: SqliteDatabase): Repositories {
  return {
    patients: new SQLitePatientRepository(db),
    appointments: new SQLiteAppointmentRepository(db),
    visits: new SQLiteVisitRepository(db),
    clinicalNotes: new SQLiteClinicalNoteRepository(db),
    treatments: new SQLiteTreatmentRepository(db),
    treatmentRecords: new SQLiteTreatmentRecordRepository(db),
    clinics: new SQLiteClinicRepository(db),
    dentists: new SQLiteDentistRepository(db),
    chairs: new SQLiteChairRepository(db),
  };
}
