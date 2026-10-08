/**
 * Payment allocation persistence, on PostgreSQL.
 *
 * A payment may be split across invoices and an invoice settled by several
 * payments, which is why allocations are their own table with a composite
 * primary key: a duplicate split is impossible at the database, not merely
 * discouraged. Nothing in this milestone edits or recalls an allocation, so
 * `save` is the whole repository.
 *
 * `save` takes no clinic, because the use case built the payment and the
 * invoice inside its transaction and the allocation merely names them. The one
 * refusal it translates is the payment's foreign key — a payment written a
 * moment ago cannot lead, but the invoice's is the sibling write; a `23503`
 * reaching the API as a 500 is what this translation prevents.
 */
import {
  DomainError,
  type PaymentAllocation,
  type PaymentAllocationRepository,
} from '@denti-code-u3/domain';

import { paymentAllocations } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

export class DrizzlePaymentAllocationRepository implements PaymentAllocationRepository {
  constructor(private readonly db: DentiDatabase) {}

  async save(allocation: PaymentAllocation): Promise<void> {
    try {
      await this.db.insert(paymentAllocations).values({
        paymentId: allocation.paymentId,
        invoiceId: allocation.invoiceId,
        amountMinor: allocation.amountMinor,
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Payment ${allocation.paymentId} was not found`, {
          entity: 'Payment',
          id: allocation.paymentId,
        });
      }
      throw error;
    }
  }
}
