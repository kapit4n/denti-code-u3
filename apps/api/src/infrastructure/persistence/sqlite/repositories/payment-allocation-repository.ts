/**
 * Payment allocation persistence, on SQLite — the twin of
 * `repositories/payment-allocation-repository.ts` (ADR 0025).
 *
 * The composite-primary-key table, the insert-only port and the translated
 * payment foreign key are the same file: the only differences here are the
 * engine's — the schema entry point, the synchronous `.run()` this driver
 * needs for an insert to happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY`
 * standing in for PostgreSQL's `23503`.
 */
import {
  DomainError,
  type PaymentAllocation,
  type PaymentAllocationRepository,
} from '@denti-code-u3/domain';

import { paymentAllocations } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

export class SQLitePaymentAllocationRepository implements PaymentAllocationRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(allocation: PaymentAllocation): Promise<void> {
    try {
      this.db
        .insert(paymentAllocations)
        .values({
          paymentId: allocation.paymentId,
          invoiceId: allocation.invoiceId,
          amountMinor: allocation.amountMinor,
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Payment ${allocation.paymentId} was not found`, {
          entity: 'Payment',
          id: allocation.paymentId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }
}
