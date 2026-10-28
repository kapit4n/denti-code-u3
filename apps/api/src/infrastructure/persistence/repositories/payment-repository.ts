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
} from '@denti-code-u3/database/schema';

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

  /**
   * Every payment this patient made to this clinic — the balance read's other half.
   *
   * Deliberately not a join and deliberately not an existence check (see the port):
   * scope is the payment's own two columns, and `[]` is the answer for a patient
   * with nothing to show. The invoice read is what tells the route whether the
   * patient is here at all, so querying the patient twice would buy no second answer.
   */
  async findForPatient(clinicId: ClinicId, patientId: PatientId): Promise<readonly Payment[]> {
    const rows = await this.db
      .select(PAYMENT_COLUMNS)
      .from(payments)
      .where(and(eq(payments.clinicId, clinicId), eq(payments.patientId, patientId)))
      .orderBy(desc(payments.receivedAt), desc(payments.id));

    return rows.map(toEntity);
  }

  /**
   * The clinic's ledger for a window, with the patient name the row shows.
   *
   * The window is half-open `[from, to)`, and the aggregate runs over the same
   * predicate as the page so "collected" is the period's figure, not the page's.
   */
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
        totalAmountMinor: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int`,
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
