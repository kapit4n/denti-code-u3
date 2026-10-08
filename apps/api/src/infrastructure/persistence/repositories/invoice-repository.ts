/**
 * Invoice persistence, on PostgreSQL — the settlement's document row.
 *
 * An invoice is a legal document whose totals are **written down, not derived on
 * read** — the `invoices` table persists `subtotal_minor` and `total_minor` on
 * purpose, so a price edited after the fact can never change a printed total. The
 * repository writes them through the domain's own `calculateInvoiceTotals`, the
 * same helper the future ledger reads, so a number stored twice cannot disagree
 * with a number derived once (ADR 0011's "one implementation" rule, applied to a
 * number).
 *
 * The entity does not carry everything the table has — `number`, `notes`,
 * `issued_at`, `due_at` and `created_by` stay null here because nothing in this
 * milestone produces them; the settlement stamps no sequence number and no
 * author (ADR 0022's user-model open question). Columns the table defaults are
 * left to default.
 *
 * `save` takes no clinic, because the use case resolved the visit and the clinic
 * inside its transaction. The one refusal it translates is the patient's foreign
 * key — a patient deleted between the read and the insert answers `NOT_FOUND`
 * rather than a `23503` reaching the API as a 500.
 */
import {
  calculateInvoiceTotals,
  DomainError,
  type Invoice,
  type InvoiceRepository,
} from '@denti-code-u3/domain';

import { invoices } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: DentiDatabase) {}

  async save(invoice: Invoice): Promise<void> {
    const { subtotal, total } = calculateInvoiceTotals(invoice);

    try {
      await this.db.insert(invoices).values({
        id: invoice.id,
        clinicId: invoice.clinicId,
        patientId: invoice.patientId,
        status: invoice.status,
        currency: invoice.currency,
        discountMinor: invoice.discountMinor,
        taxRatePercent: String(invoice.taxRatePercent),
        subtotalMinor: subtotal.amountMinor,
        totalMinor: total.amountMinor,
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${invoice.patientId} was not found`, {
          entity: 'Patient',
          id: invoice.patientId,
        });
      }
      throw error;
    }
  }
}
