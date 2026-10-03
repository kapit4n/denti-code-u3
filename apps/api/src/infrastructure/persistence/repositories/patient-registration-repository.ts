/**
 * The write side of patient persistence, on PostgreSQL.
 *
 * This is the first implementation behind a domain port, and it exists because
 * registration needs two things that are awkward inline in a route handler:
 *
 *  - **clinic scoping on write.** ADR 0014 requires `clinic_id` to come from the
 *    scope the caller was given, never from ambient state. Here it is the
 *    `clinic_id` on the row being written, taken from the `Patient` the use case
 *    built from the request's clinic scope.
 *  - **an atomic record number.** See `register`.
 *
 * The read side of the patient port is deliberately not implemented here. The
 * list and detail endpoints were written before this layer existed and still
 * query Drizzle in their own handlers; implementing `search` and `findById` now
 * would add two methods nothing calls. Reads move across when next touched.
 */

import { sql } from 'drizzle-orm';

import { nextPatientRecordNumber, type PatientRegistrationRepository } from '@denti-code-u3/domain';
import { DomainError } from '@denti-code-u3/domain';
import { patients } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';

/** Postgres `unique_violation`. The only way a number can still collide. */
const PG_UNIQUE_VIOLATION = '23505';

/** How far down a `cause` chain to look for a driver error code. */
const MAX_CAUSE_DEPTH = 5;

/**
 * One row of the "highest issued record number" query.
 *
 * `readonly` fields are fine for reading, but Drizzle's `execute` generic
 * requires an index signature, so the shape is declared as a record.
 */
type RecordNumberRow = Record<string, unknown> & {
  readonly record_number?: string | null;
};

export class DrizzlePatientRegistrationRepository implements PatientRegistrationRepository {
  constructor(private readonly db: DentiDatabase) {}

  /**
   * Assign the next record number for the clinic and insert the patient, in one
   * transaction.
   *
   * The `pg_advisory_xact_lock` is the reason this is safe. Without it, two
   * receptionists registering at the same moment both read the highest issued
   * number, both compute the same successor, and the unique index then rejects
   * one of them — in front of a patient who is already at the desk. The lock is
   * transaction scoped (`xact`), so PostgreSQL releases it when the enclosing
   * transaction ends, including on an exception; a crashed request cannot leak
   * it and wedge the clinic's registrations.
   *
   * The lock key is derived from the clinic id, not a fixed constant, so two
   * clinics in the same database never block each other.
   */
  async register(patient: Parameters<PatientRegistrationRepository['register']>[0]) {
    const clinicId = patient.clinicId;

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${clinicId}))`);

        const issued = await tx.execute<RecordNumberRow>(sql`
          SELECT record_number
          FROM patients
          WHERE clinic_id = ${clinicId}
            AND record_number ~ '^P-[0-9]+$'
          ORDER BY length(record_number) DESC, record_number DESC
          LIMIT 1
        `);

        const highest = issued[0]?.record_number ?? null;
        const recordNumber = nextPatientRecordNumber(highest ? [highest] : []);

        await tx.insert(patients).values({
          id: patient.id,
          clinicId,
          recordNumber,
          firstName: patient.firstName,
          lastName: patient.lastName,
          preferredName: patient.preferredName ?? null,
          identificationNumber: patient.identificationNumber ?? null,
          phone: patient.phone ?? null,
          email: patient.email ?? null,
          birthDate: patient.birthDate ?? null,
          isActive: patient.isActive,
        });

        return { recordNumber };
      });
    } catch (error) {
      // The advisory lock makes this unreachable in practice, so reaching it
      // means something outside this repository wrote to the table. It is still
      // mapped rather than left to become a 500: a duplicate chart number is a
      // conflict the caller can be told about, not an internal fault.
      if (isUniqueViolation(error)) {
        throw new DomainError('DUPLICATED_RECORD', 'That record number is already taken', {
          field: 'recordNumber',
        });
      }
      throw error;
    }
  }
}

/**
 * Whether an error is a Postgres unique violation.
 *
 * Not a plain `error.code` check: Drizzle rethrows driver failures wrapped in its
 * own `DrizzleQueryError` and moves the original to `cause`, so the code is one
 * level down. Reading it off the wrong object returns `undefined` for every error
 * and silently turns a conflict into a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if ((current as { readonly code?: unknown }).code === PG_UNIQUE_VIOLATION) {
      return true;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }

  return false;
}
