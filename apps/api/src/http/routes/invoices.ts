/**
 * The invoice read side: one patient's documents, and one document whole.
 *
 * Milestone 9's first look at the ledger from the outside. An invoice is raised
 * by `POST /api/v1/visits/:visitId/invoices` (and, as a side effect, by a
 * settlement); these two reads are where a document is then found and quoted.
 * Both are scoped to the clinic on the request (ADR 0014) — the clinic is never
 * in the path, the patient is the subject of the list, and an invoice another
 * clinic holds is not this clinic's to read.
 *
 * A patient this clinic does not hold is a 404 on the list, not an empty page:
 * `findForPatient` distinguishes "no such patient" (undefined) from "a patient
 * with no bills yet" (`[]`), exactly as the plan read does. A single invoice that
 * is not here is a 404 too, the same answer whether it never existed or belongs
 * to someone else.
 */

import type { FastifyInstance } from 'fastify';

import type { InvoiceRepository } from '@denti-code-u3/domain';
import { asInvoiceId, asPatientId, type ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface InvoiceRoutesDependencies {
  /** The document's read half: scoped by clinic and patient, and by clinic and id. */
  readonly invoices: InvoiceRepository;
}

export async function registerInvoiceRoutes(
  app: FastifyInstance,
  { invoices }: InvoiceRoutesDependencies,
): Promise<void> {
  /**
   * Every invoice a patient holds, newest first, with its stored totals, the money
   * allocated to it and what is left.
   *
   * The totals are the document's own written-down numbers, never a recompute — an
   * invoice is a legal document and its printed total must not move when a price is
   * edited later.
   */
  app.get('/api/v1/patients/:patientId/invoices', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { patientId } = request.params as { patientId: string };

    try {
      const list = await invoices.findForPatient(clinicId, asPatientId(patientId));

      if (!list) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No patient with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      return { items: list };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the invoices');
    }
  });

  /**
   * One invoice, with the charges it folded in — the document's own detail.
   *
   * 404 when this clinic holds no such invoice, which is also the answer for one
   * that belongs to another clinic: the two cases must be indistinguishable, or the
   * endpoint reports whose invoices exist elsewhere.
   */
  app.get('/api/v1/invoices/:invoiceId', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { invoiceId } = request.params as { invoiceId: string };

    try {
      const invoice = await invoices.findById(clinicId, asInvoiceId(invoiceId));

      if (!invoice) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No invoice with that id exists in this clinic',
            requestId: request.id,
          },
        });
      }

      return invoice;
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read the invoice');
    }
  });
}
