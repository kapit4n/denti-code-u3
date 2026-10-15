/**
 * Invoice persistence, on SQLite — the twin of
 * `repositories/invoice-repository.ts` (ADR 0025).
 *
 * The written-down totals via the domain's `calculateInvoiceTotals`, the number
 * assigned by the store through `nextInvoiceNumber`, the translated patient
 * foreign key, and the two ledger reads are the same file: the only differences
 * here are the engine's.
 *
 * **No advisory lock.** PostgreSQL needs `pg_advisory_xact_lock` because two
 * pooled connections can read the same highest number between each other's read
 * and insert. SQLite has no pool — this connection is synchronous and exclusive
 * to this process (see `connection.ts`), so the read of the highest number and
 * the insert run back to back with nothing able to interleave. The unique index
 * is still there as the last word, and its refusal is mapped to the same
 * `DUPLICATED_RECORD` a conflict answers with rather than a 500. The rest of the
 * differences are the engine's own: the schema entry point, the synchronous
 * `.run()` this driver needs for an insert to happen at all, `GLOB` in place of
 * PostgreSQL's `~`, and `SQLITE_CONSTRAINT_FOREIGNKEY` standing in for `23503`.
 */
import {
  calculateInvoiceTotals,
  DomainError,
  nextInvoiceNumber,
  type Invoice,
  type InvoiceDetail,
  type InvoiceRepository,
  type InvoiceStatus,
  type InvoiceSummary,
} from '@denti-code-u3/domain';
import {
  asInvoiceId,
  type ClinicId,
  type CurrencyCode,
  type InvoiceId,
  type IsoDateTime,
  type PatientId,
} from '@denti-code-u3/types';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  charges,
  invoices,
  patients,
  paymentAllocations,
} from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation, isUniqueViolation } from '../sqlite-error.js';
import { CHARGE_COLUMNS, toEntity as toChargeEntity } from './charge-repository.js';

/** The invoice columns the two reads answer with. */
const INVOICE_COLUMNS = {
  id: invoices.id,
  number: invoices.number,
  status: invoices.status,
  currency: invoices.currency,
  subtotalMinor: invoices.subtotalMinor,
  discountMinor: invoices.discountMinor,
  taxRatePercent: invoices.taxRatePercent,
  totalMinor: invoices.totalMinor,
  issuedAt: invoices.issuedAt,
  createdAt: invoices.createdAt,
} as const;

/**
 * One row of the "highest issued number" query.
 *
 * Drizzle's `all` generic requires an index signature, so the shape is a record —
 * the same concession the patient register makes.
 */
type InvoiceNumberRow = Record<string, unknown> & {
  readonly number?: string | null;
};

export class SQLiteInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async issue(invoice: Invoice): Promise<string> {
    const { subtotal, total } = calculateInvoiceTotals(invoice);

    try {
      const issued = this.db.all<InvoiceNumberRow>(sql`
        SELECT number
        FROM invoices
        WHERE clinic_id = ${invoice.clinicId}
          AND number GLOB 'F001-[0-9][0-9]*'
        ORDER BY length(number) DESC, number DESC
        LIMIT 1
      `);

      const highest = issued[0]?.number ?? null;
      const number = nextInvoiceNumber(highest ? [highest] : []);

      this.db
        .insert(invoices)
        .values({
          id: invoice.id,
          number,
          clinicId: invoice.clinicId,
          patientId: invoice.patientId,
          status: invoice.status,
          currency: invoice.currency,
          discountMinor: invoice.discountMinor,
          taxRatePercent: String(invoice.taxRatePercent),
          subtotalMinor: subtotal.amountMinor,
          totalMinor: total.amountMinor,
          issuedAt: invoice.issuedAt ? new Date(invoice.issuedAt) : undefined,
        })
        .run();

      return number;
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${invoice.patientId} was not found`, {
          entity: 'Patient',
          id: invoice.patientId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      if (isUniqueViolation(error)) {
        throw new DomainError('DUPLICATED_RECORD', 'That invoice number is already taken', {
          field: 'number',
        });
      }
      throw error;
    }
  }

  async findForPatient(
    clinicId: ClinicId,
    patientId: PatientId,
  ): Promise<readonly InvoiceSummary[] | undefined> {
    const patient = await this.db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.clinicId, clinicId)))
      .limit(1);

    if (patient.length === 0) {
      return undefined;
    }

    const rows = await this.db
      .select(INVOICE_COLUMNS)
      .from(invoices)
      .where(and(eq(invoices.clinicId, clinicId), eq(invoices.patientId, patientId)))
      .orderBy(desc(invoices.createdAt), desc(invoices.id));

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const counts = await this.chargeCounts(ids);
    const allocated = await this.allocatedTotals(ids);

    return rows.map((row) => toSummary(row, counts.get(row.id) ?? 0, allocated.get(row.id) ?? 0));
  }

  async findById(clinicId: ClinicId, invoiceId: InvoiceId): Promise<InvoiceDetail | undefined> {
    const rows = await this.db
      .select(INVOICE_COLUMNS)
      .from(invoices)
      .where(and(eq(invoices.clinicId, clinicId), eq(invoices.id, invoiceId)))
      .limit(1);

    const row = rows[0];

    if (!row) {
      return undefined;
    }

    const chargeRows = await this.db
      .select(CHARGE_COLUMNS)
      .from(charges)
      .where(and(eq(charges.clinicId, clinicId), eq(charges.invoiceId, invoiceId)))
      .orderBy(asc(charges.createdAt), asc(charges.id));

    const allocated = await this.allocatedTotals([invoiceId]);

    return {
      ...toSummary(row, chargeRows.length, allocated.get(invoiceId) ?? 0),
      charges: chargeRows.map(toChargeEntity),
    };
  }

  /** How many charges each invoice folded in, as a map keyed by invoice id. */
  private async chargeCounts(ids: readonly string[]): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ invoiceId: charges.invoiceId, count: sql<number>`count(*)` })
      .from(charges)
      .where(inArray(charges.invoiceId, ids))
      .groupBy(charges.invoiceId);

    return new Map(rows.flatMap((row) => (row.invoiceId ? [[row.invoiceId, row.count]] : [])));
  }

  /** How much was allocated to each invoice, as a map keyed by invoice id. */
  private async allocatedTotals(ids: readonly string[]): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        invoiceId: paymentAllocations.invoiceId,
        allocated: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)`,
      })
      .from(paymentAllocations)
      .where(inArray(paymentAllocations.invoiceId, ids))
      .groupBy(paymentAllocations.invoiceId);

    return new Map(rows.map((row) => [row.invoiceId, row.allocated]));
  }
}

function toSummary(
  row: {
    id: string;
    number: string | null;
    status: string;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    taxRatePercent: string;
    totalMinor: number;
    issuedAt: Date | null;
    createdAt: Date;
  },
  chargeCount: number,
  allocatedMinor: number,
): InvoiceSummary {
  return {
    id: asInvoiceId(row.id),
    number: row.number,
    status: row.status as InvoiceStatus,
    currency: row.currency as CurrencyCode,
    subtotalMinor: row.subtotalMinor,
    discountMinor: row.discountMinor,
    taxRatePercent: Number(row.taxRatePercent),
    totalMinor: row.totalMinor,
    allocatedMinor,
    // An over-allocation is impossible by the settlement's own rule, so the floor
    // is a defence against a bad row, not a business case.
    balanceMinor: Math.max(0, row.totalMinor - allocatedMinor),
    chargeCount,
    issuedAt: row.issuedAt ? (row.issuedAt.toISOString() as IsoDateTime) : null,
    createdAt: row.createdAt.toISOString() as IsoDateTime,
  };
}
