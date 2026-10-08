/**
 * Invoice persistence, on SQLite — the twin of
 * `repositories/invoice-repository.ts` (ADR 0025).
 *
 * The written-down totals via the domain's `calculateInvoiceTotals`, the
 * columns this milestone leaves null, and the translated patient foreign key
 * are the same file: the only differences here are the engine's — the schema
 * entry point, the synchronous `.run()` this driver needs for an insert to
 * happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY` standing in for
 * PostgreSQL's `23503`.
 */
import {
  calculateInvoiceTotals,
  DomainError,
  type Invoice,
  type InvoiceRepository,
} from '@denti-code-u3/domain';

import { invoices } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

export class SQLiteInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(invoice: Invoice): Promise<void> {
    const { subtotal, total } = calculateInvoiceTotals(invoice);

    try {
      this.db
        .insert(invoices)
        .values({
          id: invoice.id,
          clinicId: invoice.clinicId,
          patientId: invoice.patientId,
          status: invoice.status,
          currency: invoice.currency,
          discountMinor: invoice.discountMinor,
          taxRatePercent: String(invoice.taxRatePercent),
          subtotalMinor: subtotal.amountMinor,
          totalMinor: total.amountMinor,
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${invoice.patientId} was not found`, {
          entity: 'Patient',
          id: invoice.patientId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }
}
