/**
 * Payment persistence, on SQLite — the twin of
 * `repositories/payment-repository.ts` (ADR 0025).
 *
 * The four-table join that scopes `findForVisit` to one visit, the `distinct`
 * payment columns, the `received_at, id` register order and the translated
 * patient foreign key are the same file: the only differences here are the
 * engine's — the schema entry point, the synchronous `.run()` this driver needs
 * for an insert to happen at all, and `SQLITE_CONSTRAINT_FOREIGNKEY` standing
 * in for PostgreSQL's `23503`.
 */
import {
  DomainError,
  type Payment,
  type PaymentLedgerEntry,
  type PaymentLedgerPage,
  type PaymentLedgerQuery,
  type PaymentRepository,
} from '@denti-code-u3/domain';
import {
  asClinicId,
  asPatientId,
  asPaymentId,
  type ClinicId,
  type IsoDateTime,
  type PatientId,
  type VisitId,
} from '@denti-code-u3/types';
import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';

import {
  charges,
  invoices,
  patients,
  paymentAllocations,
  payments,
} from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { isForeignKeyViolation } from '../sqlite-error.js';

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

export class SQLitePaymentRepository implements PaymentRepository {
  constructor(private readonly db: SqliteDatabase) {}

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

  /** The balance read's other half; see the port for why it is neither a join nor an existence check. */
  async findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Payment[]> {
    const rows = await this.db
      .select(PAYMENT_COLUMNS)
      .from(payments)
      .where(and(eq(payments.clinicId, clinicId), eq(payments.patientId, patientId)))
      .orderBy(desc(payments.receivedAt), desc(payments.id));

    return rows.map(toEntity);
  }

  /** The clinic ledger; see the PostgreSQL twin for the half-open window contract. */
  async listForClinic(clinicId: ClinicId, query: PaymentLedgerQuery): Promise<PaymentLedgerPage> {
    const where = and(
      eq(payments.clinicId, clinicId),
      gte(payments.receivedAt, new Date(query.from)),
      lt(payments.receivedAt, new Date(query.to)),
      query.method ? eq(payments.method, query.method) : undefined,
    );

    const rows = await this.db
      .select({
        ...PAYMENT_COLUMNS,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientPreferredName: patients.preferredName,
      })
      .from(payments)
      .innerJoin(
        patients,
        and(eq(patients.id, payments.patientId), eq(patients.clinicId, payments.clinicId)),
      )
      .where(where)
      .orderBy(desc(payments.receivedAt), desc(payments.id))
      .limit(query.limit)
      .offset(query.offset);

    const [aggregate] = await this.db
      .select({
        total: count(),
        totalAmountMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)`,
      })
      .from(payments)
      .where(where);

    return {
      items: rows.map(toLedgerEntry),
      total: aggregate?.total ?? 0,
      totalAmountMinor: aggregate?.totalAmountMinor ?? 0,
    };
  }

  async save(payment: Payment): Promise<void> {
    try {
      this.db
        .insert(payments)
        .values({
          id: payment.id,
          clinicId: payment.clinicId,
          patientId: payment.patientId,
          method: payment.method,
          currency: payment.currency,
          amountMinor: payment.amountMinor,
          reference: payment.reference,
          receivedAt: new Date(payment.receivedAt),
        })
        .run();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new DomainError('NOT_FOUND', `Patient ${payment.patientId} was not found`, {
          entity: 'Patient',
          id: payment.patientId,
          sqliteCode: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
      }
      throw error;
    }
  }
}

function toLedgerEntry(row: {
  id: string;
  clinicId: string;
  patientId: string;
  method: Payment['method'];
  currency: string;
  amountMinor: number;
  reference: string | null;
  receivedAt: Date;
  patientFirstName: string;
  patientLastName: string;
  patientPreferredName: string | null;
}): PaymentLedgerEntry {
  return {
    id: asPaymentId(row.id),
    patientId: asPatientId(row.patientId),
    patientName: row.patientPreferredName ?? `${row.patientFirstName} ${row.patientLastName}`,
    method: row.method,
    currency: row.currency as Payment['currency'],
    amountMinor: row.amountMinor,
    reference: row.reference,
    receivedAt: row.receivedAt.toISOString() as IsoDateTime,
  };
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
