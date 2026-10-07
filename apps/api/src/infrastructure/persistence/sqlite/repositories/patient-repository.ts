/**
 * Patient persistence, on SQLite.
 *
 * The SQLite twin of `repositories/patient-repository.ts`, written against the
 * SQLite schema (ADR 0025), with the differences the engine dictates:
 *
 *  - **`register` has no transaction and no advisory lock.** better-sqlite3's
 *    `transaction()` cannot be given an async callback, and registration does
 *    not need one anyway: everything it does — read the highest issued record
 *    number, compute the successor, insert — is synchronous on one connection
 *    (`this.db.all`/`.run` return values, not promises), so the read-then-insert
 *    is an atomic critical section with no interleaving at all. The `await`s
 *    that would appear here would be no-op microtasks; there are none to write.
 *    Two registration requests in one process simply run one after the other.
 *  - **The "highest issued number" read uses `GLOB`, not a regex.** SQLite's
 *    `regexp` is a loadable extension; `record_number GLOB 'P-[0-9][0-9]*'` is
 *    built in and is the exact equivalent of `~ '^P-[0-9]+$'`.
 *  - **The duplicate refusal is `SQLITE_CONSTRAINT_UNIQUE`**, mapped to the
 *    same `DUPLICATED_RECORD` as the PostgreSQL side's `23505`.
 *  - **The balance casts are gone.** PostgreSQL's `sum()` of a `bigint` arrives
 *    as a string, hence `::int`; SQLite's integer arithmetic already returns
 *    numbers, so the same expression needs no cast.
 *
 * Everything else is the same file: every method is clinic-scoped (ADR 0014),
 * every read excludes anonymised rows, and `LIKE ... ESCAPE` + the folded term
 * keep accents matching on both engines.
 */

import {
  DomainError,
  nextPatientRecordNumber,
  type EditablePatientDetails,
  type Patient,
  type PatientFinancialBalance,
  type PatientListEntry,
  type PatientOdontogram,
  type PatientProfile,
  type PatientRepository,
  type PatientSearchQuery,
} from '@denti-code-u3/domain';
import {
  asAppointmentId,
  asClinicId,
  asDentistId,
  asPatientId,
  asTreatmentPlanId,
  asVisitId,
  type ClinicId,
  type IsoDateTime,
  type PatientId,
} from '@denti-code-u3/types';
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  appointments,
  charges,
  clinics,
  odontogramEntries,
  patients,
  payments,
  treatmentPlanItems,
  treatmentPlans,
  visits,
} from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { foldAccents, sqliteFoldable as foldable } from '../../fold-accents.js';
import { isUniqueViolation } from '../sqlite-error.js';

export { isUniqueViolation } from '../sqlite-error.js';

/**
 * Escape the LIKE metacharacters, so a patient recorded as `100%` is findable
 * and a search for `%` cannot match every row in the clinic.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Fold a search term the way the SQL folds a stored name; absent means no term. */
function normaliseTerm(term: string | undefined): string | null {
  if (term === undefined) return null;
  const folded = foldAccents(term.trim()).toLowerCase();
  return folded.length === 0 ? null : folded;
}

/** An integer `timestamp_ms` column as an ISO 8601 string. */
function isoTimestamp(value: Date): IsoDateTime {
  return value.toISOString();
}

/**
 * One row of the "highest issued record number" query. `readonly` fields are
 * fine for reading, but Drizzle's `all` generic requires an index signature.
 */
type RecordNumberRow = Record<string, unknown> & {
  readonly record_number?: string | null;
};

export class SQLitePatientRepository implements PatientRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Assign the next record number for the clinic and insert the patient.
   *
   * See the module comment for why this is safe without a transaction or a
   * lock: the calls below are synchronous on the single connection, so no other
   * work can slip between the read and the insert. The unique index is still
   * there as the final word, and if it ever speaks — something outside this
   * repository wrote to the table — its refusal is mapped to a conflict the
   * front desk can be told about rather than a 500.
   */
  async register(patient: Patient) {
    const clinicId = patient.clinicId;

    try {
      const issued = this.db.all<RecordNumberRow>(sql`
        SELECT record_number
        FROM patients
        WHERE clinic_id = ${clinicId}
          AND record_number GLOB 'P-[0-9][0-9]*'
        ORDER BY length(record_number) DESC, record_number DESC
        LIMIT 1
      `);

      const highest = issued[0]?.record_number ?? null;
      const recordNumber = nextPatientRecordNumber(highest ? [highest] : []);

      // `.run()`, not the bare builder: on this driver a statement does nothing
      // until it is executed, and a register that quietly writes nothing would
      // answer 201 while the patient is nowhere.
      this.db
        .insert(patients)
        .values({
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
        })
        .run();

      return { recordNumber };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('DUPLICATED_RECORD', 'That record number is already taken', {
          field: 'recordNumber',
        });
      }
      throw error;
    }
  }

  /**
   * Overwrite the editable fields, scoped to one clinic, in a single statement.
   *
   * Same guarantees as the PostgreSQL twin: the clinic scope is in the `WHERE`,
   * an anonymised record is out of reach, and only the editable columns are in
   * the `SET` list.
   */
  async update(
    clinicId: ClinicId,
    patientId: PatientId,
    details: EditablePatientDetails,
  ): Promise<boolean> {
    const rows = await this.db
      .update(patients)
      .set({
        firstName: details.firstName,
        lastName: details.lastName,
        preferredName: details.preferredName ?? null,
        identificationNumber: details.identificationNumber ?? null,
        phone: details.phone ?? null,
        email: details.email ?? null,
        birthDate: details.birthDate ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(patients.id, patientId),
          eq(patients.clinicId, clinicId),
          isNull(patients.anonymizedAt),
        ),
      )
      .returning({ id: patients.id });

    return rows.length > 0;
  }

  /**
   * One page of the clinic's patients, and the count on the same predicate —
   * the same two-query shape as the PostgreSQL twin.
   */
  async search(
    clinicId: ClinicId,
    query: PatientSearchQuery,
  ): Promise<{
    readonly items: readonly PatientListEntry[];
    readonly total: number;
  }> {
    const term = normaliseTerm(query.term);

    const searchFilter = term
      ? or(
          sql`${foldable(patients.firstName)} LIKE ${`%${escapeLikePattern(term)}%`} ESCAPE '\\'`,
          sql`${foldable(patients.lastName)} LIKE ${`%${escapeLikePattern(term)}%`} ESCAPE '\\'`,
          sql`${foldable(sql`coalesce(${patients.recordNumber}, '')`)} LIKE ${`%${escapeLikePattern(term)}%`} ESCAPE '\\'`,
        )
      : undefined;

    const where = and(
      eq(patients.clinicId, clinicId),
      isNull(patients.anonymizedAt),
      searchFilter,
      query.onlyActive ? eq(patients.isActive, true) : undefined,
    );

    const [rows, [totals]] = await Promise.all([
      this.db
        .select({
          id: patients.id,
          recordNumber: patients.recordNumber,
          firstName: patients.firstName,
          lastName: patients.lastName,
          preferredName: patients.preferredName,
          phone: patients.phone,
          email: patients.email,
          birthDate: patients.birthDate,
          isActive: patients.isActive,
          createdAt: patients.createdAt,
        })
        .from(patients)
        .where(where)
        .orderBy(asc(foldable(patients.lastName)), asc(foldable(patients.firstName)))
        .limit(query.page.limit)
        .offset(query.page.offset),
      this.db.select({ total: count() }).from(patients).where(where),
    ]);

    return {
      items: rows.map((row) => ({
        id: asPatientId(row.id),
        recordNumber: row.recordNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        preferredName: row.preferredName,
        phone: row.phone,
        email: row.email,
        birthDate: row.birthDate,
        isActive: row.isActive,
        createdAt: isoTimestamp(row.createdAt),
      })),
      total: totals?.total ?? 0,
    };
  }

  /**
   * The clinical profile, or `undefined` when this clinic holds no such patient.
   *
   * Five queries, all issued together, exactly as on PostgreSQL. The patient is
   * fetched first and alone because only it can answer "this is not a patient".
   */
  async findProfile(clinicId: ClinicId, patientId: PatientId): Promise<PatientProfile | undefined> {
    const [patient] = await this.db
      .select()
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, clinicId),
          eq(patients.id, patientId),
          isNull(patients.anonymizedAt),
        ),
      )
      .limit(1);

    if (!patient) {
      return undefined;
    }

    const now = new Date();

    const [[upcomingAppointment], recentVisits, outstandingTreatmentItems, [balance]] =
      await Promise.all([
        this.db
          .select({
            id: appointments.id,
            startsAt: appointments.startsAt,
            durationMinutes: appointments.durationMinutes,
            status: appointments.status,
            dentistId: appointments.dentistId,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.clinicId, clinicId),
              eq(appointments.patientId, patientId),
              gte(appointments.startsAt, now),
              ne(appointments.status, 'CANCELLED'),
            ),
          )
          .orderBy(asc(appointments.startsAt))
          .limit(1),
        this.db
          .select({
            id: visits.id,
            status: visits.status,
            startedAt: visits.startedAt,
            endedAt: visits.endedAt,
            reason: visits.reason,
            summary: visits.summary,
            createdAt: visits.createdAt,
          })
          .from(visits)
          .where(and(eq(visits.clinicId, clinicId), eq(visits.patientId, patientId)))
          .orderBy(desc(sql`coalesce(${visits.startedAt}, ${visits.createdAt})`))
          .limit(10),
        this.db
          .select({
            id: treatmentPlanItems.id,
            planId: treatmentPlans.id,
            planStatus: treatmentPlans.status,
            title: treatmentPlans.title,
            tooth: treatmentPlanItems.tooth,
            quantity: treatmentPlanItems.quantity,
            estimatedPriceMinor: treatmentPlanItems.estimatedPriceMinor,
          })
          .from(treatmentPlanItems)
          .innerJoin(treatmentPlans, eq(treatmentPlans.id, treatmentPlanItems.treatmentPlanId))
          .where(
            and(
              eq(treatmentPlans.clinicId, clinicId),
              eq(treatmentPlans.patientId, patientId),
              eq(treatmentPlanItems.isCompleted, false),
              inArray(treatmentPlans.status, ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS']),
            ),
          )
          .orderBy(asc(treatmentPlans.createdAt))
          .limit(25),
        this.db
          .select({
            /**
             * Billed minus paid, in minor units. The expression is integer
             * arithmetic like the PostgreSQL one, but without its `::int` casts:
             * SQLite already returns a number for `sum()` of integers, where
             * PostgreSQL needs the cast because its `bigint` sum arrives as a
             * string. Never a float on either engine.
             */
            outstandingMinor: sql<number>`(
              coalesce((
                select sum(${charges.unitPriceMinor} * ${charges.quantity} - ${charges.discountMinor})
                from ${charges}
                where ${charges.clinicId} = ${clinicId}
                  and ${charges.patientId} = ${patientId}
              ), 0)
              - coalesce((
                select sum(${payments.amountMinor}) from ${payments}
                where ${payments.clinicId} = ${clinicId}
                  and ${payments.patientId} = ${patientId}
              ), 0)
            )`,
            chargeCount: sql<number>`(
              select count(*) from ${charges}
              where ${charges.clinicId} = ${clinicId}
                and ${charges.patientId} = ${patientId}
            )`,
            currencyCode: clinics.currencyCode,
          })
          .from(clinics)
          .where(eq(clinics.id, clinicId))
          .limit(1),
      ]);

    return {
      id: asPatientId(patient.id),
      clinicId: asClinicId(patient.clinicId),
      recordNumber: patient.recordNumber,
      firstName: patient.firstName,
      lastName: patient.lastName,
      preferredName: patient.preferredName,
      identificationNumber: patient.identificationNumber,
      phone: patient.phone,
      email: patient.email,
      birthDate: patient.birthDate,
      address: patient.address,
      allergies: patient.allergies,
      additionalData: patient.additionalData ?? {},
      isActive: patient.isActive,
      createdAt: isoTimestamp(patient.createdAt),
      updatedAt: isoTimestamp(patient.updatedAt),
      upcomingAppointment:
        upcomingAppointment === undefined
          ? null
          : {
              id: asAppointmentId(upcomingAppointment.id),
              startsAt: isoTimestamp(upcomingAppointment.startsAt),
              durationMinutes: upcomingAppointment.durationMinutes,
              status: upcomingAppointment.status,
              dentistId:
                upcomingAppointment.dentistId === null
                  ? null
                  : asDentistId(upcomingAppointment.dentistId),
            },
      recentVisits: recentVisits.map((visit) => ({
        id: asVisitId(visit.id),
        status: visit.status,
        startedAt: visit.startedAt === null ? null : isoTimestamp(visit.startedAt),
        endedAt: visit.endedAt === null ? null : isoTimestamp(visit.endedAt),
        reason: visit.reason,
        summary: visit.summary,
        createdAt: isoTimestamp(visit.createdAt),
      })),
      outstandingTreatments: outstandingTreatmentItems.map((item) => ({
        id: item.id,
        planId: asTreatmentPlanId(item.planId),
        planStatus: item.planStatus,
        title: item.title,
        tooth: item.tooth,
        quantity: item.quantity,
        estimatedPriceMinor: item.estimatedPriceMinor,
      })),
      financialBalance: {
        outstandingMinor: balance?.outstandingMinor ?? 0,
        chargeCount: balance?.chargeCount ?? 0,
        currencyCode: balance?.currencyCode ?? null,
      } satisfies PatientFinancialBalance,
    };
  }

  /**
   * The odontogram chart, or `undefined` when this clinic holds no such patient
   * — the same existence check with the same `anonymized_at` filter.
   */
  async findOdontogram(
    clinicId: ClinicId,
    patientId: PatientId,
  ): Promise<PatientOdontogram | undefined> {
    const [patient] = await this.db
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, clinicId),
          eq(patients.id, patientId),
          isNull(patients.anonymizedAt),
        ),
      )
      .limit(1);

    if (!patient) {
      return undefined;
    }

    const entries = await this.db
      .select({
        id: odontogramEntries.id,
        dentition: odontogramEntries.dentition,
        tooth: odontogramEntries.tooth,
        surfaces: odontogramEntries.surfaces,
        condition: odontogramEntries.condition,
        notes: odontogramEntries.notes,
        recordedAt: odontogramEntries.recordedAt,
      })
      .from(odontogramEntries)
      .where(eq(odontogramEntries.patientId, patientId))
      .orderBy(asc(odontogramEntries.dentition), asc(odontogramEntries.tooth));

    return {
      entries: entries.map((entry) => ({
        ...entry,
        recordedAt: isoTimestamp(entry.recordedAt),
      })),
    };
  }
}
