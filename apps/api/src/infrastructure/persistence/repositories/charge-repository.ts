/**
 * Charge persistence, on PostgreSQL.
 *
 * **The first billing row with a `clinic_id` of its own**, and that is the one
 * difference between this file and its clinical companions (ADR 0014, ADR 0025):
 *
 *  - **`findForVisit` needs no join.** A prescription row cannot tell which clinic
 *    owns it, so the prescription repository joins `visits` to scope. A charge
 *    carries its own `clinic_id`, so this read filters on the charge's own column —
 *    the scoping that for its siblings had to live in a join lives here in a where.
 *    The use case still reads the visit first; the clinic filter is where the visit's
 *    tenancy is double-checked on the way to the list.
 *  - **`save` takes no clinic, because the use case already read the visit in this
 *    clinic.** What `save` cannot know is whether that visit still exists, so the one
 *    refusal it translates is the foreign key: a visit deleted between the read and
 *    the insert answers `NOT_FOUND` rather than a `23503` reaching the API as a 500.
 *
 * `quantity` and `tax_rate_percent` come back from the `numeric` columns as strings
 * and are converted here, so the entity a route answers with is already a number —
 * the same conversion the SQLite twin makes in `toEntity`, without a cast changing
 * columns between engines (ADR 0025).
 *
 * Order is `created_at` ascending with the id as a tiebreak: the order a bill grew
 * in, and two charges raised in the same millisecond still have a stable reading
 * order.
 */
import { DomainError, type Charge, type ChargeRepository } from '@denti-code-u3/domain';
import {
  asChargeId,
  asClinicId,
  asInvoiceId,
  asPatientId,
  asTreatmentId,
  asVisitId,
  type ClinicId,
  type CurrencyCode,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import { and, asc, eq } from 'drizzle-orm';

import { charges } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation } from '../postgres-error.js';

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

export class DrizzleChargeRepository implements ChargeRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      await this.db.insert(charges).values({
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
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Visit ${charge.visitId} was not found`, {
          entity: 'Visit',
          id: charge.visitId,
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
    // about the row, not an absent field: a charge without a visit is a non-clinical
    // charge — one filed from the patient tab, where Task 2's billing lives.
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
