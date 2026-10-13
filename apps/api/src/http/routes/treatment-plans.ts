import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { treatmentPlanCreateSchema, treatmentPlanUpdateSchema } from '@denti-code-u3/validation';
import { asClinicId, asPatientId, asTreatmentPlanId } from '@denti-code-u3/types';
import { createTreatmentPlan } from '@denti-code-u3/domain';


export async function registerTreatmentPlanRoutes(server: FastifyInstance) {
  server.post('/clinics/:clinicId/patients/:patientId/treatment-plans', async (request, reply) => {
    const params = z
      .object({ clinicId: z.string().min(1), patientId: z.string().min(1) })
      .parse(request.params);
    const body = treatmentPlanCreateSchema.parse(request.body ?? {});
    const plan = await createTreatmentPlan(
      asClinicId(params.clinicId),
      {
        ...body,
        patientId: asPatientId(params.patientId),
        dentistId: body.dentistId ? (body.dentistId as any) : null,
        items: body.items.map((i) => ({
          ...i,
          treatmentId: i.treatmentId ? (i.treatmentId as any) : null,
        })) as any,
      } as any,
      {
        patients: (server as any).deps.patients,
        dentists: (server as any).deps.dentists,
        treatments: (server as any).deps.treatments,
        treatmentPlans: (server as any).deps.treatmentPlans,
        clock: (server as any).deps.clock,
        newId: () => (server as any).deps.newId(),
        newItemId: () => (server as any).deps.newId(),
      },
    );
    return reply.status(201).send({ plan });
  });

  server.patch('/clinics/:clinicId/patients/:patientId/treatment-plans/:planId', async (request) => {
    const params = z
      .object({ clinicId: z.string().min(1), patientId: z.string().min(1), planId: z.string().min(1) })
      .parse(request.params);
    const body = treatmentPlanUpdateSchema.parse(request.body ?? {});
    const { updateTreatmentPlan } = await import('@denti-code-u3/domain');
    await updateTreatmentPlan(
      asClinicId(params.clinicId),
      asPatientId(params.patientId),
      asTreatmentPlanId(params.planId),
      body,
      {
        patients: (server as any).deps.patients,
        dentists: (server as any).deps.dentists,
        treatments: (server as any).deps.treatments,
        treatmentPlans: (server as any).deps.treatmentPlans,
        clock: (server as any).deps.clock,
      },
    );
    return { ok: true };
  });

  server.post(
    '/clinics/:clinicId/patients/:patientId/treatment-plans/:planId/items/:itemId/complete',
    async (request) => {
      const params = z
        .object({ clinicId: z.string().min(1), patientId: z.string().min(1), planId: z.string().min(1), itemId: z.string().min(1) })
        .parse(request.params);
      const { completeTreatmentPlanItem } = await import('@denti-code-u3/domain');
      await completeTreatmentPlanItem(
        asClinicId(params.clinicId),
        asTreatmentPlanId(params.planId),
        params.itemId,
        {
          treatmentPlans: (server as any).deps.treatmentPlans,
          clock: (server as any).deps.clock,
        },
      );
      return { ok: true };
    },
  );
}
