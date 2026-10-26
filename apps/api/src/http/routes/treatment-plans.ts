/**
 * The treatment-plan write side: proposing a plan, moving it along, and marking a
 * line done.
 *
 * The read (`GET /api/v1/patients/:patientId/treatment-plans`) lives with the
 * patient routes because it is a patient-scoped read; the writes live here because
 * they are a resource of their own, the same split the visit books keep. Every
 * endpoint is scoped to the clinic on the request (ADR 0014): `clinicId` is never in
 * a body, the patient is the subject on the path, and the id and the clock belong to
 * the server.
 *
 * The plan id and the item id are minted here — the plan from the id generator, each
 * line from the same generator — and the status a new plan opens in (`DRAFT`), the
 * `presentedAt`/`acceptedAt` stamps and the progress projection are the domain's. A
 * body that cannot name a plan is refused 422 before the domain is asked; a plan the
 * clinic does not hold answers 404; a body naming a treatment or dentist the clinic
 * does not hold answers 422 from the use case rather than a 500 from the driver.
 */

import type { FastifyInstance } from 'fastify';

import type {
  Clock,
  DentistRepository,
  IdGenerator,
  PatientRepository,
  TreatmentPlanRepository,
  TreatmentRepository,
} from '@denti-code-u3/domain';
import {
  completeTreatmentPlanItem,
  createTreatmentPlan,
  updateTreatmentPlan,
} from '@denti-code-u3/domain';
import { createTreatmentPlanSchema, updateTreatmentPlanSchema } from '@denti-code-u3/validation';
import {
  asDentistId,
  asPatientId,
  asTreatmentId,
  asTreatmentPlanId,
  type ClinicId,
  type TreatmentPlanId,
} from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface TreatmentPlanRoutesDependencies {
  /** Reads the subject and proves it belongs to this clinic before a write. */
  readonly patients: PatientRepository;
  /** Reads a named dentist so a plan cannot name one from another clinic. */
  readonly dentists: DentistRepository;
  /** Reads a named treatment so a plan cannot name one the clinic does not offer. */
  readonly treatments: TreatmentRepository;
  /** The plan's own write half: read scoped by clinic and patient, save whole. */
  readonly treatmentPlans: TreatmentPlanRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export async function registerTreatmentPlanRoutes(
  app: FastifyInstance,
  { patients, dentists, treatments, treatmentPlans, ids, clock }: TreatmentPlanRoutesDependencies,
): Promise<void> {
  /**
   * Propose a plan for the patient on the path.
   *
   * The body is the plan's own fields — an optional dentist, a title, notes, and at
   * least one item — and never the patient: the subject is the path (ADR 0014). The
   * plan opens in `DRAFT`; `presentedAt` and `acceptedAt` are the server's to stamp
   * later. What is stored is what this endpoint answers with, so the client's
   * refetch and this 201 cannot disagree.
   */
  app.post(
    '/api/v1/patients/:patientId/treatment-plans',
    { config: { permission: 'treatments:write' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const { patientId } = request.params as { patientId: string };
      const parsed = createTreatmentPlanSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The treatment plan could not be accepted',
            details: { issues: parsed.error.issues },
            requestId: request.id,
          },
        });
      }

      try {
        const plan = await createTreatmentPlan(
          clinicId,
          {
            patientId: asPatientId(patientId),
            dentistId: parsed.data.dentistId ? asDentistId(parsed.data.dentistId) : null,
            title: parsed.data.title ?? null,
            notes: parsed.data.notes ?? null,
            items: parsed.data.items.map((item) => ({
              treatmentId: item.treatmentId ? asTreatmentId(item.treatmentId) : null,
              tooth: item.tooth ?? null,
              surfaces: item.surfaces,
              quantity: item.quantity,
              estimatedPriceMinor: item.estimatedPriceMinor,
              notes: item.notes ?? null,
            })),
          },
          {
            patients,
            dentists,
            treatments,
            treatmentPlans,
            clock,
            newId: (): TreatmentPlanId => asTreatmentPlanId(ids.nextId()),
            newItemId: () => ids.nextId(),
          },
        );

        return reply.status(201).send({ plan });
      } catch (error) {
        // A patient this clinic does not hold answers 404; a named dentist or
        // treatment the clinic does not hold answers 422; both arrive as a
        // `DomainError` and are mapped by `sendProblem`, never a 500.
        return sendProblem(reply, request, error);
      }
    },
  );

  /**
   * Move a plan along: its status, its title, its notes.
   *
   * Answers 204 with no body — the client refetches the plans list it is about to
   * draw, and a body assembled from the request would be a value that was never
   * stored. A plan that is not this patient's answers 404, whether it does not exist
   * or belongs to another patient, because the two are the same answer on purpose.
   */
  app.patch(
    '/api/v1/patients/:patientId/treatment-plans/:planId',
    { config: { permission: 'treatments:write' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const { patientId, planId } = request.params as { patientId: string; planId: string };
      const parsed = updateTreatmentPlanSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The treatment plan update could not be accepted',
            details: { issues: parsed.error.issues },
            requestId: request.id,
          },
        });
      }

      try {
        await updateTreatmentPlan(
          clinicId,
          asPatientId(patientId),
          asTreatmentPlanId(planId),
          parsed.data,
          { patients, treatmentPlans, clock },
        );

        return reply.status(204).send();
      } catch (error) {
        return sendProblem(reply, request, error);
      }
    },
  );

  /**
   * Mark one line of a plan done.
   *
   * Bodyless: the completion is the verb, and an item already done keeps its first
   * `completedAt`, so a second call is not a second write. A plan that is not this
   * patient's, or an item that is not this plan's, answers 404 — a success that
   * changed nothing would be the worst answer a write can give.
   */
  app.post(
    '/api/v1/patients/:patientId/treatment-plans/:planId/items/:itemId/complete',
    { config: { permission: 'treatments:write' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const { patientId, planId, itemId } = request.params as {
        patientId: string;
        planId: string;
        itemId: string;
      };

      try {
        await completeTreatmentPlanItem(
          clinicId,
          asPatientId(patientId),
          asTreatmentPlanId(planId),
          itemId,
          { patients, treatmentPlans, clock },
        );

        return reply.status(204).send();
      } catch (error) {
        return sendProblem(reply, request, error);
      }
    },
  );
}
