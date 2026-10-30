/**
 * The invoice ledger: one patient's documents, one document whole, what the
 * patient owes across both, the statement that puts them in order, and the payment
 * that settles one document.
 *
 * Milestone 9's look at the ledger from the outside. An invoice is raised by
 * `POST /api/v1/visits/:visitId/invoices` (and, as a side effect, by a settlement);
 * these reads are where a document is then found and quoted, where the money is
 * totalled up, and where the history is read oldest first. The payment write records
 * money against one existing document, fully allocated to it (ADR 0034). All of them
 * are scoped to the clinic on the request (ADR 0014) — the clinic is never in the
 * path, the patient is the subject, and a document another clinic holds is not this
 * clinic's to read or pay.
 *
 * A patient this clinic does not hold is a 404 on every one of them, not an empty
 * page: "no such patient" and "a patient with no bills yet" are different answers,
 * and a statement that cannot tell them apart would tell a stranger their balance is
 * zero. The document, balance and statement reads decide that from the store's own
 * `undefined`-versus-`[]`, so the HTTP layer never has to.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  getPatientBalance,
  getPatientStatement,
  payInvoice,
  type ClinicRepository,
  type Clock,
  type IdGenerator,
  type InvoiceRepository,
  type PaymentRepository,
  type UnitOfWork,
} from '@denti-code-u3/domain';
import { createPaymentSchema, uuidSchema } from '@denti-code-u3/validation';
import {
  asInvoiceId,
  asPatientId,
  asPaymentId,
  type ClinicId,
  type InvoiceId,
} from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface InvoiceRoutesDependencies {
  /** The document's read half: scoped by clinic and patient, and by clinic and id. */
  readonly invoices: InvoiceRepository;
  /** The balance read's other half: the money this patient has paid this clinic. */
  readonly payments: PaymentRepository;
  /** The frame the balance is stated in — a clinic names its own currency. */
  readonly clinics: ClinicRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export async function registerInvoiceRoutes(
  app: FastifyInstance,
  { invoices, payments, clinics, unitOfWork, clock, ids }: InvoiceRoutesDependencies,
): Promise<void> {
  /**
   * Every invoice a patient holds, newest first, with its stored totals, the money
   * allocated to it and what is left.
   *
   * The totals are the document's own written-down numbers, never a recompute — an
   * invoice is a legal document and its printed total must not move when a price is
   * edited later.
   */
  app.get(
    '/api/v1/patients/:patientId/invoices',
    { config: { permission: 'billing:read' } },
    async (request, reply) => {
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
    },
  );

  /**
   * One invoice, with the charges it folded in — the document's own detail.
   *
   * 404 when this clinic holds no such invoice, which is also the answer for one
   * that belongs to another clinic: the two cases must be indistinguishable, or the
   * endpoint reports whose invoices exist elsewhere.
   */
  app.get(
    '/api/v1/invoices/:invoiceId',
    { config: { permission: 'billing:read' } },
    async (request, reply) => {
      const path = readInvoiceId(request.params, request.clinicId as ClinicId);

      if (!path.valid) {
        return sendInvalidInvoiceId(reply, request);
      }

      try {
        const invoice = await invoices.findById(path.clinicId, path.invoiceId);

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
    },
  );

  app.post(
    '/api/v1/invoices/:invoiceId/payments',
    { config: { permission: 'billing:write' } },
    async (request, reply) => {
      const path = readInvoiceId(request.params, request.clinicId as ClinicId);

      if (!path.valid) {
        return sendInvalidInvoiceId(reply, request);
      }

      const parsed = createPaymentSchema.safeParse(request.body);

      if (!parsed.success) {
        return sendInvalidPaymentBody(reply, request, parsed.error);
      }

      try {
        const payment = await payInvoice(
          path.clinicId,
          path.invoiceId,
          {
            method: parsed.data.method,
            amountMinor: parsed.data.amountMinor,
            ...(parsed.data.reference != null ? { reference: parsed.data.reference } : {}),
          },
          {
            unitOfWork,
            clock,
            newPaymentId: () => asPaymentId(ids.nextId()),
          },
        );

        return reply.status(201).send(payment);
      } catch (error) {
        return sendProblem(reply, request, error);
      }
    },
  );

  /**
   * What the patient owes this clinic: billed, allocated, outstanding, credit, and
   * the balance.
   *
   * The five figures rather than one, because a desk asking "what does she owe" is
   * usually asking whether the last payment landed. They are added up by the domain
   * from the documents' own stored totals — never recomputed from charges, so the
   * answer agrees with the paper the patient was handed (open question T6).
   *
   * A patient this clinic does not hold is a 404, thrown by the use case rather than
   * assembled here: a zero balance and a stranger's id must not be the same answer.
   */
  app.get(
    '/api/v1/patients/:patientId/balance',
    { config: { permission: 'billing:read' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const { patientId } = request.params as { patientId: string };

      try {
        return await getPatientBalance(clinicId, asPatientId(patientId), {
          invoices,
          payments,
          clinics,
        });
      } catch (error) {
        return sendProblem(reply, request, error, 'Failed to read the balance');
      }
    },
  );

  /**
   * The patient's statement: every issued document and every payment, oldest first,
   * with the balance after each line.
   *
   * The history behind the balance, not a second balance. The same two reads and the
   * same currency the summary uses, ordered by when each line happened; the closing
   * figure therefore equals `GET …/balance`'s `balanceMinor`. Drafts and voids are
   * not lines, but the payments that once pointed at them are — money received does
   * not stop existing because the document was retired.
   *
   * A patient this clinic does not hold is a 404, thrown by the use case before the
   * clinic or the payments are read.
   */
  app.get(
    '/api/v1/patients/:patientId/statement',
    { config: { permission: 'billing:read' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const { patientId } = request.params as { patientId: string };

      try {
        return await getPatientStatement(clinicId, asPatientId(patientId), {
          invoices,
          payments,
          clinics,
        });
      } catch (error) {
        return sendProblem(reply, request, error, 'Failed to read the statement');
      }
    },
  );
}

type ParsedInvoicePath =
  | { readonly valid: true; readonly invoiceId: InvoiceId; readonly clinicId: ClinicId }
  | { readonly valid: false };

function readInvoiceId(params: unknown, clinicId: ClinicId): ParsedInvoicePath {
  const candidate = (params as { invoiceId?: unknown } | undefined)?.invoiceId;

  if (typeof candidate !== 'string' || !uuidSchema.safeParse(candidate).success) {
    return { valid: false };
  }

  return { valid: true, invoiceId: asInvoiceId(candidate), clinicId };
}

function sendInvalidInvoiceId(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The invoice id in the path is not a uuid',
      details: { issues: [{ path: ['invoiceId'], code: 'invalid_uuid' }] },
      requestId: request.id,
    },
  });
}

function sendInvalidPaymentBody(
  reply: FastifyReply,
  request: FastifyRequest,
  error: { readonly issues: unknown },
): FastifyReply {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The payment could not be recorded',
      details: { issues: error.issues },
      requestId: request.id,
    },
  });
}
