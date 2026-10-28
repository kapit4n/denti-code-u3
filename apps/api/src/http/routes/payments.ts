/**
 * The clinic's payment ledger.
 *
 * The sidebar has pointed Pay here since the shell was built. This is the read
 * behind it: money received in a clinic-local period, for a manager who needs the
 * week's takings rather than one visit's register. The route parses dates, resolves
 * them in the clinic's own zone and asks the payment repository for a page; every
 * statement stays in the repository, as it does for every other read (ADR 0014).
 *
 * **It is a ledger, not a settlement door.** Recording money still happens on the
 * visit that owes it, where the domain can refuse more than the bill and write the
 * invoice, payment and allocation in one transaction. A standalone "take a payment"
 * form here would need a patient and a document to allocate against, and inventing
 * that pair beside the visit is the second way to record the same fact.
 *
 * **`billing:read`, not `clinic:manage`.** An administrator is the manager the page
 * was requested for, but a receptionist who takes money also has to answer "what came
 * in today". The route reports the clinic-wide ledger to every role the domain grants
 * `billing:read`; the UI may hide the link, but the API is the control.
 */

import type { FastifyInstance } from 'fastify';

import type { ClinicRepository, PaymentRepository } from '@denti-code-u3/domain';
import { DomainError } from '@denti-code-u3/domain';
import { paymentLedgerQuerySchema } from '@denti-code-u3/validation';
import type { ClinicId, IsoDateTime } from '@denti-code-u3/types';

import { resolveClinicDateRange } from '../../application/clinic-time-window.js';
import { sendProblem } from '../problem.js';

/** The same ceiling a report uses; a crafted query cannot scan the whole ledger. */
export const MAX_PAYMENT_LEDGER_DAYS = 366;

/** Ceiling on a page size, so `?limit=` cannot ask for the whole ledger at once. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

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

export interface PaymentsDependencies {
  readonly payments: PaymentRepository;
  readonly clinics: ClinicRepository;
}

export async function registerPaymentsRoutes(
  app: FastifyInstance,
  { payments, clinics }: PaymentsDependencies,
): Promise<void> {
  app.get(
    '/api/v1/payments',
    { config: { permission: 'billing:read' } },
    async (request, reply) => {
      const clinicId = request.clinicId as ClinicId;
      const parsed = paymentLedgerQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The payment period could not be accepted',
            details: { issues: parsed.error.issues },
            requestId: request.id,
          },
        });
      }

      const { from, to, method } = parsed.data;
      const query = request.query as { page?: string; limit?: string };
      const page = resolvePage(query.page);
      const limit = resolvePageSize(query.limit);

      try {
        const clinic = await clinics.findById(clinicId);

        if (!clinic) {
          throw new DomainError('NOT_FOUND', `Clinic ${clinicId} was not found`, {
            entity: 'Clinic',
            id: clinicId,
          });
        }

        const range = resolveClinicDateRange(from, to, clinic.timeZone);

        if (range.days.length > MAX_PAYMENT_LEDGER_DAYS) {
          return reply.status(422).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: `A payment period may not span more than ${MAX_PAYMENT_LEDGER_DAYS} days`,
              requestId: request.id,
            },
          });
        }

        const ledger = await payments.listForClinic(clinicId, {
          from: range.start.toISOString() as IsoDateTime,
          to: range.end.toISOString() as IsoDateTime,
          method,
          offset: (page - 1) * limit,
          limit,
        });

        return {
          period: { from, to, timeZone: clinic.timeZone },
          currencyCode: clinic.currency,
          items: ledger.items,
          totalAmountMinor: ledger.totalAmountMinor,
          pagination: {
            page,
            limit,
            total: ledger.total,
            totalPages: Math.ceil(ledger.total / limit),
          },
        };
      } catch (error) {
        return sendProblem(reply, request, error, 'Failed to list payments');
      }
    },
  );
}
