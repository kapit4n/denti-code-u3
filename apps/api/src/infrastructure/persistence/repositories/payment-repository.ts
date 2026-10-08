/**
 * Payment persistence, on PostgreSQL — the register and the money received.
 *
 * `save` writes one `payments` row and translates the patient's foreign key like
 * every sibling write here: the use case already resolved the visit and the
 * clinic inside its transaction, and a patient deleted between the read and the
 * insert answers `NOT_FOUND` rather than a `23503` as a 500.
 *
 * `findForVisit` is where this repository is not a sibling. **A payment carries
 * no `visit_id`** — the money reaches the visit through its allocation, its
 * invoice, and the charges that invoice folded in — so the read is a join
 * over all four tables, and the clinic filter sits on the *charges*, the rows
 * that actually name the visit. That join is what keeps a payment legitimately
 * off the register: money received for this patient but allocated to another
 * invoice cannot show up on this visit's bill (ADR 0014, ADR 0025).
 *
 * The join produces one row per charge under the invoice, so the payment columns
 * are selected **distinct** — a payment appears once no matter how many charges
 * its invoice names. Newest received first, then by id: the order a payment
 * register is read in.
 */
import { DomainError, type Payment, type PaymentRepository } from '@denti-code-u3/domain';
import {
  asClinicId,
  asPatientId,
  asPaymentId,
  type ClinicId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, desc, eq } from 'drizzle-orm';

import { charges, invoices, paymentAllocations, payments } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

const PAYMENT_COLUMNS = {
  id: payments.id,
  clinicId: payments.clinicId,
  patientId: payments.patientId,
  method: payments.method,
  currency: payments.currency,
  amountMinor: payments.amountMinor,
  reference: payments.reference,
  receivedAt: payments.receivedAt,
} as const;

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly db: DentiDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Payment[]> {
    const rows = await this.db
      .selectDistinct(PAYMENT_COLUMNS)
      .from(payments)
      .innerJoin(paymentAllocations, eq(paymentAllocations.paymentId, payments.id))
      .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .innerJoin(charges, eq(charges.invoiceId, invoices.id))
      .where(and(eq(charges.clinicId, clinicId), eq(charges.visitId, visitId)))
      .orderBy(desc(payments.receivedAt), desc(payments.id));

    return rows.map(toEntity);
  }

  async save(payment: Payment): Promise<void> {
    try {
      await this.db.insert(payments).values({
        id: payment.id,
        clinicId: payment.clinicId,
        patientId: payment.patientId,
        method: payment.method,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        reference: payment.reference,
        receivedAt: new Date(payment.receivedAt),
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${payment.patientId} was not found`, {
          entity: 'Patient',
          id: payment.patientId,
        });
      }
      throw error;
    }
  }
}

function toEntity(row: {
  id: string;
  clinicId: string;
  patientId: string;
  method: Payment['method'];
  currency: string;
  amountMinor: number;
  reference: string | null;
  receivedAt: Date;
}): Payment {
  return {
    id: asPaymentId(row.id),
    clinicId: asClinicId(row.clinicId),
    patientId: asPatientId(row.patientId),
    method: row.method,
    currency: row.currency as Payment['currency'],
    amountMinor: row.amountMinor,
    reference: row.reference,
    receivedAt: row.receivedAt.toISOString() as IsoDateTime,
  };
}
