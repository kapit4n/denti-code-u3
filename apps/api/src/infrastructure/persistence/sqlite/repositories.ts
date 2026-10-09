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
import { SQLiteChargeRepository } from './repositories/charge-repository.js';
import { SQLiteClinicalNoteRepository } from './repositories/clinical-note-repository.js';
import { SQLiteClinicRepository } from './repositories/clinic-repository.js';
import { SQLiteDentistRepository } from './repositories/dentist-repository.js';
import { SQLiteInvoiceRepository } from './repositories/invoice-repository.js';
import { SQLiteOdontogramEntryRepository } from './repositories/odontogram-entry-repository.js';
import { SQLitePatientRepository } from './repositories/patient-repository.js';
import { SQLitePaymentAllocationRepository } from './repositories/payment-allocation-repository.js';
import { SQLitePaymentRepository } from './repositories/payment-repository.js';
import { SQLitePrescriptionRepository } from './repositories/prescription-repository.js';
import { SQLiteTreatmentPlanRepository } from './repositories/treatment-plan-repository.js';
import { SQLiteTreatmentRecordRepository } from './repositories/treatment-record-repository.js';
import { SQLiteTreatmentRepository } from './repositories/treatment-repository.js';
import { SQLiteVisitAttachmentRepository } from './repositories/visit-attachment-repository.js';
import { SQLiteVisitRepository } from './repositories/visit-repository.js';

export function sqliteRepositoriesFor(db: SqliteDatabase): Repositories {
  return {
    patients: new SQLitePatientRepository(db),
    appointments: new SQLiteAppointmentRepository(db),
    visits: new SQLiteVisitRepository(db),
    clinicalNotes: new SQLiteClinicalNoteRepository(db),
    prescriptions: new SQLitePrescriptionRepository(db),
    charges: new SQLiteChargeRepository(db),
    treatments: new SQLiteTreatmentRepository(db),
    treatmentRecords: new SQLiteTreatmentRecordRepository(db),
    treatmentPlans: new SQLiteTreatmentPlanRepository(db),
    clinics: new SQLiteClinicRepository(db),
    dentists: new SQLiteDentistRepository(db),
    chairs: new SQLiteChairRepository(db),
    invoices: new SQLiteInvoiceRepository(db),
    payments: new SQLitePaymentRepository(db),
    paymentAllocations: new SQLitePaymentAllocationRepository(db),
    attachments: new SQLiteVisitAttachmentRepository(db),
    odontogramEntries: new SQLiteOdontogramEntryRepository(db),
  };
}
