/**
 * Invoice persistence, on PostgreSQL — the settlement's document row and the
 * ledger's two reads.
 *
 * An invoice is a legal document whose totals are **written down, not derived on
 * read** — the `invoices` table persists `subtotal_minor` and `total_minor` on
 * purpose, so a price edited after the fact can never change a printed total. The
 * repository writes them through the domain's own `calculateInvoiceTotals`, the
 * same helper the ledger reads, so a number stored twice cannot disagree with a
 * number derived once (ADR 0011's "one implementation" rule, applied to a number).
 *
 * **The number is the store's to assign.** `issue` reads the highest number the
 * clinic has already issued, asks the domain for the successor
 * (`nextInvoiceNumber`), and inserts it — the record-number rule, on the other
 * document a clinic quotes out loud. The read and the insert are made atomic by
 * `pg_advisory_xact_lock`, taken on the clinic id: without it two concurrent
 * issuers read the same highest and the `(clinic_id, number)` unique index rejects
 * one of them. The lock is transaction-scoped, so the identity is unique per clinic
 * and the identity of what is locked is the clinic id, so two clinics never block
 * each other. `issue` is only ever called inside a `UnitOfWork` transaction; the
 * lock has no meaning outside one.
 *
 * `issue` also translates the patient's foreign key — a patient deleted between the
 * read and the insert answers `NOT_FOUND` rather than a `23503` reaching the API as a
 * 500.
 *
 * The two reads are the ledger. `findForPatient` is a patient's documents with their
 * stored totals, the money allocated to each and the count of charges they folded
 * in; it answers `undefined` when the patient is not in this clinic, so a list route
 * can 404 rather than leak a foreign id, and `[]` when the patient simply has no
 * bills. `findById` is one document with its charges — the same charge rows, mapped
 * through the charge repository's own `toEntity`, so the two engines and the two
 * reads cannot drift.
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
  asPatientId,
  type ClinicId,
  type CurrencyCode,
  type InvoiceId,
  type IsoDateTime,
  type PatientId,
} from '@denti-code-u3/types';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { charges, invoices, patients, paymentAllocations } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { isForeignKeyViolation, isUniqueViolation } from '../postgres-error.js';
import { CHARGE_COLUMNS, toEntity as toChargeEntity } from './charge-repository.js';

/** The invoice columns the two reads answer with. */
const INVOICE_COLUMNS = {
  id: invoices.id,
  patientId: invoices.patientId,
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
 * Drizzle's `execute` generic requires an index signature, so the shape is a
 * record — the same concession the patient register makes.
 */
type InvoiceNumberRow = Record<string, unknown> & {
  readonly number?: string | null;
};

export class DrizzleInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: DentiDatabase) {}

  async issue(invoice: Invoice): Promise<string> {
    const { subtotal, total } = calculateInvoiceTotals(invoice);

    try {
      // No `this.db.transaction` here: `issue` is only ever called inside a
      // `UnitOfWork` transaction, where `this.db` already *is* that transaction's
      // handle. A nested transaction would be a second boundary inside the first
      // (ADR 0021), and the xact lock below would be scoped to the wrong one.
      //
      // The lock is taken on the clinic so two clinics never serialise against
      // each other, and held until the enclosing transaction ends.
      await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${invoice.clinicId}))`);

      const issued = await this.db.execute<InvoiceNumberRow>(sql`
        SELECT number
        FROM invoices
        WHERE clinic_id = ${invoice.clinicId}
          AND number ~ '^F001-[0-9]+$'
        ORDER BY length(number) DESC, number DESC
        LIMIT 1
      `);

      const highest = issued[0]?.number ?? null;
      const number = nextInvoiceNumber(highest ? [highest] : []);

      await this.db.insert(invoices).values({
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
      });

      return number;
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${invoice.patientId} was not found`, {
          entity: 'Patient',
          id: invoice.patientId,
        });
      }
      if (isUniqueViolation(error)) {
        // The advisory lock makes this unreachable, so reaching it means the lock
        // was bypassed; the unique index is still the last word, and it speaks as a
        // conflict rather than a 500.
        throw new DomainError('DUPLICATED_RECORD', 'That invoice number is already taken', {
          field: 'number',
        });
      }
      throw error;
    }
  }

  async updateStatus(
    clinicId: ClinicId,
    invoiceId: InvoiceId,
    status: InvoiceStatus,
  ): Promise<void> {
    await this.db
      .update(invoices)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.clinicId, clinicId)));
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
      .select({ invoiceId: charges.invoiceId, count: sql<number>`count(*)::int` })
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
        allocated: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::int`,
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
    patientId: string;
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
    patientId: asPatientId(row.patientId),
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
