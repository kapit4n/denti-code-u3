/**
 * Patient persistence, on PostgreSQL.
 *
 * The only place in the application that knows patients are rows in a table. The
 * read methods used to live in the route handlers, which meant a route could
 * forget a filter: `anonymized_at is null` had to be written out by hand at each
 * of the three places that read a patient, and the odontogram's existence check
 * had in fact been written without it. A filter that only exists because someone
 * remembered is a filter that will be forgotten.
 *
 * The two properties every method here is built around:
 *
 *  - **Clinic scope is a parameter, not ambient state.** ADR 0014 requires
 *    `clinic_id` to come from the scope the caller was given. There is no method
 *    that omits it, and no query that leaves it to a default.
 *  - **A withdrawn patient is not a patient.** `anonymized_at is null` is in every
 *    query that finds or lists rows, so read and write agree about which records
 *    still exist.
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
} from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { foldAccents, foldable } from '../postgres/fold-accents.js';
import { isUniqueViolation } from '../postgres-error.js';

export { isUniqueViolation } from '../postgres-error.js';

/**
 * Escape the LIKE metacharacters, so a patient recorded as `100%` is findable and
 * a search for `%` cannot match every row in the clinic.
 *
 * Paired with the `ESCAPE '\'` in the SQL below. Without it, `%` is a wildcard
 * and a receptionist who pasted a number containing one gets the whole patient
 * list — which reads as "search is broken" at best.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Fold a search term the way the SQL folds a stored name.
 *
 * The two halves live in `postgres/fold-accents.ts`, which explains why folding is
 * needed at all; `normaliseTerm` is only the "absent means no term" part.
 */
function normaliseTerm(term: string | undefined): string | null {
  if (term === undefined) return null;
  const folded = foldAccents(term.trim()).toLowerCase();
  return folded.length === 0 ? null : folded;
}

/**
 * A `timestamptz` column as an ISO 8601 string.
 *
 * Drizzle hands back a `Date`; the read model promises `IsoDateTime`. Converting
 * here rather than letting the JSON serialiser do it is what makes the type true
 * while the object is still in memory — otherwise every caller has to remember
 * that this particular field is a `Date`, and a `String(date)` or a `.map()`
 * somewhere quietly produces `Invalid Date`.
 */
function isoTimestamp(value: Date): IsoDateTime {
  return value.toISOString();
}

/**
 * One row of the "highest issued record number" query.
 *
 * `readonly` fields are fine for reading, but Drizzle's `execute` generic
 * requires an index signature, so the shape is declared as a record.
 */
type RecordNumberRow = Record<string, unknown> & {
  readonly record_number?: string | null;
};

export class DrizzlePatientRepository implements PatientRepository {
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
  async register(patient: Patient) {
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

  /**
   * Overwrite the editable fields, scoped to one clinic, in a single statement.
   *
   * Three properties this method exists to guarantee:
   *
   *  - **The clinic scope is in the `WHERE` clause.** Not a lookup the caller did
   *    first and handed over. A patient id that belongs to another clinic must be
   *    indistinguishable from one that does not exist (ADR 0014).
   *  - **Anonymised records are out of reach.** They keep their row for
   *    traceability, so without this an edit could revive a record the product has
   *    deliberately withdrawn.
   *  - **Only the editable columns are written.** `record_number` is the chart the
   *    front desk quotes, `created_at` is a fact about the past, and `is_active` is
   *    a deliberate separate action. None of them is in the `SET` list, so no
   *    amount of carelessness upstream can move them.
   *
   * Returns whether a row was matched, which is how "not in this clinic" reaches
   * the caller as a 404 rather than a silent success.
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
   * One page of the clinic's patients.
   *
   * Two queries run at once — the page and the count — because the UI needs both
   * to render the page control, and a second round trip after the first has
   * already returned is a visible delay on every keystroke of a search.
   *
   * The count is run against the *same* predicate as the page. Counting the rows
   * in the page instead is the classic way a filtered list ends up claiming nine
   * pages of one result.
   *
   * Order is by last name then first name, which is how a receptionist's day is
   * organised; without an explicit order PostgreSQL is free to return rows in
   * whatever order the plan produces, so page 2 is not guaranteed to follow page 1.
   */
  async search(
    clinicId: ClinicId,
    query: PatientSearchQuery,
  ): Promise<{
    readonly items: readonly PatientListEntry[];
    readonly total: number;
  }> {
    const term = normaliseTerm(query.term);

    /**
     * The stored columns are folded in SQL as well as the term being folded in
     * JavaScript — folding only one side is how `Ñuñez` stops matching `nunez`.
     * Both halves come from `postgres/fold-accents.ts`.
     *
     * `LIKE ... ESCAPE` rather than `ILIKE`, so the escaping above is honoured.
     * `ILIKE` honours it too, but it cannot be turned into an index expression,
     * and this predicate is the one a clinic-sized table will want indexed.
     */
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
   * Five queries, all issued together. They are genuinely independent — nothing
   * in the balance depends on the visits — so awaiting them in sequence would pay
   * five network waits to draw one screen, on a page a clinician opens before
   * every appointment.
   *
   * The patient is fetched first and alone: it is the only one of the five that
   * can answer "this is not a patient", and running the other four first would
   * do four queries' work for a 404.
   *
   * Only single-row results are destructured as `[row]`. Bound the same way, a
   * collection query yields its *first row*, so `recentVisits` would arrive as one
   * visit object instead of a list — a bug that typechecks, because the empty
   * array fallback is the same shape as a one-element array's element at the call
   * site only if you never look.
   */
  async findProfile(clinicId: ClinicId, patientId: PatientId): Promise<PatientProfile | undefined> {
    const [patient] = await this.db
      .select()
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, clinicId),
          eq(patients.id, patientId),
          // Anonymised records keep their row for traceability but must not be
          // readable as a patient.
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
              // The plan carries the patient, so this filter is what stops the
              // profile from showing the whole clinic's outstanding work.
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
             * Billed minus paid, in minor units (see
             * `packages/domain/src/billing/money.ts`). Discounts are already
             * stored as absolute minor amounts on each charge, so the net is
             * plain arithmetic; tax is left out because whether a clinic adds
             * it at charge time or invoice time is an open product question
             * (`docs/open-questions.md`) and guessing here would invent a
             * total. Never a float: the whole expression is integer.
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
            )::int`,
            chargeCount: sql<number>`(
              select count(*) from ${charges}
              where ${charges.clinicId} = ${clinicId}
                and ${charges.patientId} = ${patientId}
            )::int`,
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
        /** Minor units of `currencyCode`. Never a decimal or a float. */
        outstandingMinor: balance?.outstandingMinor ?? 0,
        chargeCount: balance?.chargeCount ?? 0,
        currencyCode: balance?.currencyCode ?? null,
      } satisfies PatientFinancialBalance,
    };
  }

  /**
   * The odontogram chart, or `undefined` when this clinic holds no such patient.
   *
   * The existence check now carries the same `anonymized_at is null` filter as
   * every other read. It did not: the check written in the route handler omitted
   * it, so a withdrawn patient's chart was reachable at a URL that the profile it
   * belonged to had just stopped answering. That inconsistency is the reason this
   * method exists rather than a `SELECT` in the handler.
   *
   * `undefined` (404) and `{ entries: [] }` (a patient with no chart) are kept
   * distinct by returning the wrapper object.
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
