/**
 * Patient endpoints.
 *
 * Scoped to the clinic on the request (ADR 0014 — see
 * `apps/api/src/http/plugins/clinic-scope.ts`). Two scoping details are worth
 * calling out because they are the ones that leak:
 *
 *  - every read goes through `PatientRepository`, whose methods all require a
 *    `ClinicId`, so one clinic can never see another's patients;
 *  - an id belonging to another clinic answers 404, not 403, because revealing
 *    that an id exists elsewhere is itself a disclosure.
 *
 * Pagination is offset-based and bounded. The search term is a normalised string
 * matched against the name and record number inside the repository, never a SQL
 * fragment, so a crafted `?q=` cannot widen the query.
 *
 * This file imports no database driver. It used to, and the filtering it had to
 * repeat by hand is what let the odontogram endpoint answer for a withdrawn
 * patient.
 */

import type { FastifyInstance } from 'fastify';

import type {
  Clock,
  IdGenerator,
  OdontogramEntryRepository,
  PatientRepository,
  TreatmentPlanRepository,
} from '@denti-code-u3/domain';
import { recordOdontogramEntry, registerPatient, updatePatient } from '@denti-code-u3/domain';
import {
  createOdontogramEntrySchema,
  createPatientSchema,
  updatePatientSchema,
} from '@denti-code-u3/validation';
import {
  asOdontogramEntryId,
  asPatientId,
  type ClinicId,
  type OdontogramEntryId,
  type PatientId,
} from '@denti-code-u3/types';
import { sendProblem } from '../problem.js';

export interface PatientsDependencies {
  /**
   * Handles registration, editing and every read. Allocation of a record number
   * is atomic inside it, and every read it performs is clinic-scoped, so neither
   * is something a route handler has to be trusted with. The chart is this
   * repository's `findOdontogram`, not a second door.
   */
  readonly patients: PatientRepository;
  /**
   * The chart's write half, one upsert per charting, no read of its own (ADR
   * 0014): the use case reads the patient in this clinic through `patients`
   * first, so the chart is never handed a clinic of its own.
   */
  readonly odontogramEntries: OdontogramEntryRepository;
  /**
   * The patient's treatment plans, read with the patient resolved first so a
   * foreign patient answers 404 rather than an empty list (ADR 0014). The plans
   * table has its own `clinic_id`, so the read scopes in the statement.
   */
  readonly treatmentPlans: TreatmentPlanRepository;
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

export async function registerPatientsRoutes(
  app: FastifyInstance,
  { patients, odontogramEntries, treatmentPlans, ids, clock }: PatientsDependencies,
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
        patients,
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

  /**
   * Edit a patient.
   *
   * `PUT`, not `PATCH`: the body carries every editable field, so an absent
   * optional field means "this patient does not have one" rather than "leave the
   * existing value". That is what lets a receptionist clear an email recorded in
   * error, which a merge cannot express without inventing a null-for-unset
   * convention.
   *
   * Answers 204 with no body. The updated record is not returned because building
   * it honestly would mean reading the patient again immediately after writing it,
   * and the client refetches the profile it is about to display anyway. A response
   * body assembled from the request instead of the row would be a value that was
   * never stored.
   */
  app.put('/api/v1/patients/:patientId', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { patientId } = request.params as { patientId: string };
    const parsed = updatePatientSchema.safeParse(request.body);

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
      const found = await updatePatient(clinicId, patientId as PatientId, parsed.data, {
        patients,
        clock,
      });

      if (!found) {
        // The same answer for "no such patient" and "not in this clinic". Anything
        // else tells a caller that an id exists somewhere it cannot reach.
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      return reply.status(204).send();
    } catch (error) {
      // A birth date that has not happened is a domain rule, not a schema rule, so
      // it can only be caught here.
      return sendProblem(reply, request, error);
    }
  });

  /**
   * The patient list.
   *
   * A thin handler: parse the query, ask the repository, shape the envelope. The
   * clinic filter is not applied here — it is not applied *anywhere* here, which is
   * the point. `request.clinicId` is handed to the one method that can scope a
   * query, so there is no code path in which a handler could forget it.
   */
  app.get('/api/v1/patients', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const query = request.query as {
      q?: string;
      page?: string;
      limit?: string;
      onlyActive?: string;
    };

    const page = resolvePage(query.page);
    const limit = resolvePageSize(query.limit);

    try {
      const { items, total } = await patients.search(clinicId, {
        term: query.q,
        // Only honoured when actually sent as `true`. Defaulting a missing flag to
        // false would hide every deactivated patient on a first page load, which
        // is the opposite of the point of keeping them searchable.
        onlyActive: query.onlyActive === 'true',
        page: { offset: (page - 1) * limit, limit },
      });

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to list patients');
    }
  });

  /**
   * The patient profile: the central clinical context for the rest of the app.
   *
   * One round trip returns the record plus the four things a clinician needs on
   * open — allergies, the next appointment, recent visits and the outstanding
   * balance — because a profile that has to be assembled from five requests is a
   * profile that renders half-empty in practice.
   *
   * The aggregate is assembled in the repository rather than here, and the reason
   * is a bug this route used to have: the response was a spread of the raw row, so
   * `anonymized_at` was published on every profile load and any column added to
   * `patients` later would have appeared in the API by accident. Naming the fields
   * means a new column is invisible until someone adds it deliberately.
   */
  app.get('/api/v1/patients/:patientId', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { patientId } = request.params as { patientId: string };

    try {
      const profile = await patients.findProfile(clinicId, asPatientId(patientId));

      if (!profile) {
        // "No such patient" and "not in this clinic" are the same answer, so a
        // caller cannot use this endpoint to discover that an id exists
        // elsewhere (ADR 0014).
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      return profile;
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the patient profile');
    }
  });

  /**
   * The odontogram chart for one patient: the tooth-level clinical record.
   *
   * `undefined` from the repository means the clinic holds no such patient, which
   * is the same 404 the profile gives; `{ entries: [] }` is a real patient whose
   * teeth have never been charted, and renders as an empty chart.
   */
  app.get('/api/v1/patients/:patientId/odontogram', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { patientId } = request.params as { patientId: string };

    try {
      const odontogram = await patients.findOdontogram(clinicId, asPatientId(patientId));

      if (!odontogram) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      return odontogram;
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the odontogram');
    }
  });

  /**
   * One patient's treatment plans, newest first, with their items.
   *
   * `undefined` from the repository means the clinic holds no such patient — the
   * same 404 the profile and the odontogram give; `{ items: [] }` is a real patient
   * with nothing planned yet. The plans are drawn with the same components the
   * profile's outstanding-treatments card folds into one line each, now whole.
   */
  app.get('/api/v1/patients/:patientId/treatment-plans', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { patientId } = request.params as { patientId: string };

    try {
      const plans = await treatmentPlans.listForPatient(clinicId, asPatientId(patientId));

      if (!plans) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      return { items: plans };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the treatment plans');
    }
  });

  /**
   * Chart one tooth of a patient.
   *
   * The body is only the finding — tooth, condition, surfaces, notes — because the
   * subject is the patient on the path, the dentition is a fact about the tooth
   * number, and the id and the clock belong to the server (ADR 0014). Charting the
   * same tooth twice is not an error: the entry keyed on `(patient_id, tooth)` is
   * replaced, so the chart always holds one current state per tooth.
   *
   * A patient this clinic does not hold answers 404 whether the finding is well
   * formed or not; a finding that is not a finding answers 422 before the domain
   * is asked.
   */
  app.post('/api/v1/patients/:patientId/odontogram/entries', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { patientId } = request.params as { patientId: string };
    const parsed = createOdontogramEntrySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The odontogram entry could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const entry = await recordOdontogramEntry(clinicId, asPatientId(patientId), parsed.data, {
        patients,
        entries: odontogramEntries,
        clock,
        newId: (): OdontogramEntryId => asOdontogramEntryId(ids.nextId()),
      });

      return reply.status(201).send({
        id: entry.id,
        patientId: entry.patientId,
        visitId: entry.visitId,
        dentition: entry.dentition,
        tooth: entry.tooth,
        surfaces: entry.surfaces,
        condition: entry.condition,
        notes: entry.notes,
        recordedAt: entry.recordedAt,
      });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
