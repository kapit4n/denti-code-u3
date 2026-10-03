/**
 * Patient endpoints.
 *
 * Scoped to the clinic on the request (ADR 0014 — see
 * `apps/api/src/http/plugins/clinic-scope.ts`). Two scoping details are worth
 * calling out because they are the ones that leak:
 *
 *  - the list filters `clinic_id`, so one clinic never sees another's patients;
 *  - the detail lookup filters `clinic_id` *and* `is_active`, and answers 404 —
 *    not 403 — for another clinic's patient, because revealing that an id
 *    exists elsewhere is itself a disclosure.
 *
 * Pagination is offset-based and bounded, and the search matches a single
 * normalised term across the name and record number rather than raw SQL
 * fragments, so a crafted `?q=` cannot widen the query.
 */

import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';

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
import type { DentiDatabase } from '../../infrastructure/persistence/postgres/connection.js';
import type { Clock, IdGenerator, PatientRegistrationRepository } from '@denti-code-u3/domain';
import { registerPatient } from '@denti-code-u3/domain';
import { createPatientSchema } from '@denti-code-u3/validation';
import type { ClinicId } from '@denti-code-u3/types';
import { sendProblem } from '../problem.js';

export interface PatientsDependencies {
  readonly db: DentiDatabase;
  /**
   * Only the write path needs it. The read endpoints below query Drizzle
   * directly, which predates the repository layer; the registration route goes
   * through the domain use case because assigning a record number atomically is
   * not something a route handler should be doing by hand.
   */
  readonly registrations: PatientRegistrationRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Ceiling on a page size, so `?limit=` cannot ask for the whole table. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/** Cap the stored page size and reject nonsense rather than passing it to SQL. */
function resolvePageSize(raw: unknown): number {
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requested)));
}

function resolvePage(raw: unknown): number {
  const requested = Number(raw);
  if (!Number.isFinite(requested)) return 1;
  return Math.max(1, Math.trunc(requested));
}

/**
 * Escape the LIKE metacharacters so a patient called `100%` is findable and a
 * search for `%` cannot match every row. Paired with the `ESCAPE '\'` in the
 * SQL below.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * A single search term folded to lower case, so matching is case-insensitive
 * without depending on the database collation.
 */
function normaliseSearch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

export async function registerPatientsRoutes(
  app: FastifyInstance,
  { db, registrations, ids, clock }: PatientsDependencies,
): Promise<void> {
  /**
   * Register a patient.
   *
   * The body is validated by `createPatientSchema` — the same schema the form
   * uses, so the two cannot disagree about what a valid name is. Rules that are
   * business rules rather than shape rules (a birth date that has not happened
   * yet, a name that is empty once trimmed) live in the domain use case and
   * arrive here as a `DomainError`, which `sendProblem` turns into a 422.
   *
   * `clinicId` comes from the request scope, never from the body: a client that
   * could choose its own clinic would be a cross-tenant write (ADR 0014).
   */
  app.post('/api/v1/patients', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = createPatientSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The patient details could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const { patient, recordNumber } = await registerPatient(clinicId, parsed.data, {
        patients: registrations,
        ids,
        clock,
      });

      return reply.status(201).send({
        id: patient.id,
        clinicId: patient.clinicId,
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
    } catch (error) {
      // Business rules (a birth date that has not happened, a name that is empty
      // once trimmed) arrive from the use case as a `DomainError`, which
      // `sendProblem` maps to the right status. Letting it escape would make every
      // rejected form a 500 and tell the user nothing about what to fix.
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/patients', async (request, reply) => {
    const clinicId = request.clinicId;
    const query = request.query as { q?: string; page?: string; limit?: string };

    const term = normaliseSearch(query.q);
    const page = resolvePage(query.page);
    const limit = resolvePageSize(query.limit);

    /**
     * `lower(...) LIKE lower($1) ESCAPE '\'` rather than `ILIKE`, so the
     * escaping above is actually honoured and the behaviour is identical on
     * every database collation.
     */
    const searchFilter = term
      ? or(
          sql`lower(${patients.firstName}) LIKE ${`%${escapeLikePattern(term)}%`} ESCAPE '\\'`,
          sql`lower(${patients.lastName}) LIKE ${`%${escapeLikePattern(term)}%`} ESCAPE '\\'`,
          sql`lower(coalesce(${patients.recordNumber}, '')) LIKE ${`%${escapeLikePattern(term)}%`} ESCAPE '\\'`,
        )
      : undefined;

    const where = and(eq(patients.clinicId, clinicId), searchFilter);

    try {
      const [rows, [totals]] = await Promise.all([
        db
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
          .orderBy(asc(patients.lastName), asc(patients.firstName))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(patients).where(where),
      ]);

      const total = totals?.total ?? 0;
      return {
        items: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to list patients');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch patients',
          requestId: request.id,
        },
      });
    }
  });

  /**
   * The patient profile: the central clinical context for the rest of the app.
   *
   * One round trip returns the record plus the four things a clinician needs on
   * open — allergies, the next appointment, recent visits and the outstanding
   * balance — because a profile that has to be assembled from five requests is a
   * profile that renders half-empty in practice.
   */
  app.get('/api/v1/patients/:patientId', async (request, reply) => {
    const clinicId = request.clinicId;
    const { patientId } = request.params as { patientId: string };

    try {
      const [patient] = await db
        .select()
        .from(patients)
        .where(
          and(
            eq(patients.clinicId, clinicId),
            eq(patients.id, patientId),
            // Anonymised records keep their row for traceability but must not be
            // readable as a patient.
            sql`${patients.anonymizedAt} is null`,
          ),
        )
        .limit(1);

      if (!patient) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      const now = new Date();

      // Only the single-row queries are destructured through `[row]`. A
      // collection query bound the same way yields its *first row*, so
      // `recentVisits` would have been one visit object rather than a list.
      const [[upcomingAppointment], recentVisits, outstandingTreatmentItems, [balance]] =
        await Promise.all([
          db
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
          db
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
          db
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
          db
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
        ...patient,
        upcomingAppointment: upcomingAppointment ?? null,
        recentVisits: recentVisits ?? [],
        outstandingTreatments: outstandingTreatmentItems ?? [],
        financialBalance: {
          /** Minor units of `currencyCode`. Never a decimal or a float. */
          outstandingMinor: balance?.outstandingMinor ?? 0,
          chargeCount: balance?.chargeCount ?? 0,
          currencyCode: balance?.currencyCode ?? null,
        },
      };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read the patient profile');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch patient',
          requestId: request.id,
        },
      });
    }
  });

  /** The odontogram chart for one patient — the tooth-level clinical record. */
  app.get('/api/v1/patients/:patientId/odontogram', async (request, reply) => {
    const clinicId = request.clinicId;
    const { patientId } = request.params as { patientId: string };

    try {
      const [patient] = await db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.clinicId, clinicId), eq(patients.id, patientId)))
        .limit(1);

      if (!patient) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      const entries = await db
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

      return { items: entries };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to read the odontogram');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch the odontogram',
          requestId: request.id,
        },
      });
    }
  });
}
