/**
 * Charge persistence, on SQLite — the twin of
 * `repositories/charge-repository.ts` (ADR 0025).
 *
 * The clinic filter on `findForVisit` that needs no join, the translated
 * foreign-key refusal in `save`, and the `created_at, id` ordering are the same
 * file: the only differences here are the engine's — the schema entry point, the
 * synchronous `.run()` this driver needs for an insert to happen at all, and
 * `SQLITE_CONSTRAINT_FOREIGNKEY` standing in for PostgreSQL's `23503`.
 */
import { DomainError, type Charge, type ChargeRepository } from '@denti-code-u3/domain';
import {
  asChargeId,
  asClinicId,
  asInvoiceId,
  asPatientId,
  asTreatmentId,
  asVisitId,
  type ChargeId,
  type ClinicId,
  type CurrencyCode,
  type InvoiceId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { charges } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

const CHARGE_COLUMNS = {
  id: charges.id,
  clinicId: charges.clinicId,
  patientId: charges.patientId,
  visitId: charges.visitId,
  treatmentId: charges.treatmentId,
  description: charges.description,
  quantity: charges.quantity,
  unitPriceMinor: charges.unitPriceMinor,
  discountMinor: charges.discountMinor,
  taxRatePercent: charges.taxRatePercent,
  currency: charges.currency,
  invoiceId: charges.invoiceId,
  invoicedAt: charges.invoicedAt,
  createdAt: charges.createdAt,
} as const;

export class SQLiteChargeRepository implements ChargeRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findForVisit(clinicId: ClinicId, visitId: VisitId): Promise<readonly Charge[]> {
    const rows = await this.db
      .select(CHARGE_COLUMNS)
      .from(charges)
      .where(and(eq(charges.clinicId, clinicId), eq(charges.visitId, visitId)))
      .orderBy(asc(charges.createdAt), asc(charges.id));

    return rows.map(toEntity);
  }

  async save(charge: Charge): Promise<void> {
    try {
      this.db
        .insert(charges)
        .values({
          id: charge.id,
          clinicId: charge.clinicId,
          patientId: charge.patientId,
          visitId: charge.visitId,
          treatmentId: charge.treatmentId,
          description: charge.description,
          quantity: String(charge.quantity),
          unitPriceMinor: charge.unitPriceMinor,
          discountMinor: charge.discountMinor,
          taxRatePercent: String(charge.taxRatePercent),
          currency: charge.currency,
          invoiceId: charge.invoiceId,
          invoicedAt: charge.invoicedAt === null ? null : new Date(charge.invoicedAt),
          createdAt: new Date(charge.createdAt),
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${charge.visitId} was not found`, {
          entity: 'Visit',
          id: charge.visitId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }

  async markInvoiced(
    clinicId: ClinicId,
    chargeIds: readonly ChargeId[],
    invoiceId: InvoiceId,
    invoicedAt: IsoDateTime,
  ): Promise<void> {
    // The use case only calls this when there is something to stamp, but a no-op
    // here means a route calling it for an empty list never sends an empty `IN`.
    if (chargeIds.length === 0) {
      return;
    }

    this.db
      .update(charges)
      .set({
        invoiceId,
        invoicedAt: new Date(invoicedAt),
      })
      .where(and(eq(charges.clinicId, clinicId), inArray(charges.id, chargeIds)))
      .run();
  }
}

function toEntity(row: {
  id: string;
  clinicId: string;
  patientId: string;
  visitId: string | null;
  treatmentId: string | null;
  description: string;
  quantity: string;
  unitPriceMinor: number;
  discountMinor: number;
  taxRatePercent: string;
  currency: string;
  invoiceId: string | null;
  invoicedAt: Date | null;
  createdAt: Date;
}): Charge {
  return {
    id: asChargeId(row.id),
    clinicId: asClinicId(row.clinicId),
    patientId: asPatientId(row.patientId),
    // The repository's own columns are nullable by the schema, and null is a fact
    // about the row, not an absent field: a charge without a visit is a
    // non-clinical charge — one filed from the patient tab.
    visitId: row.visitId ? asVisitId(row.visitId) : null,
    treatmentId: row.treatmentId ? asTreatmentId(row.treatmentId) : null,
    description: row.description,
    quantity: Number(row.quantity),
    unitPriceMinor: row.unitPriceMinor,
    discountMinor: row.discountMinor,
    taxRatePercent: Number(row.taxRatePercent),
    currency: row.currency as CurrencyCode,
    invoiceId: row.invoiceId ? asInvoiceId(row.invoiceId) : null,
    invoicedAt: row.invoicedAt ? (row.invoicedAt.toISOString() as IsoDateTime) : null,
    createdAt: row.createdAt.toISOString() as IsoDateTime,
  };
}
