/**
 * Clinic persistence, on SQLite — the twin of
 * `repositories/clinic-repository.ts` (ADR 0025).
 *
 * The weekday semantics are identical to PostgreSQL's on purpose: the SQLite
 * schema stores `day_of_week` as an integer with `0 = Sunday … 6 = Saturday`,
 * the same numbering `extract(dow)` produces. Only the schema import and the
 * database handle differ from the PostgreSQL twin, so the ISO-8601 translation
 * lives here duplicated rather than shared — a shared helper would be a new
 * surface for the two engines to disagree on.
 */

import { asc, eq } from 'drizzle-orm';

import { clinics, clinicOperatingHours } from '@denti-code-u3/database/schema/sqlite';
import type { Clinic, ClinicOperatingHours, ClinicRepository } from '@denti-code-u3/domain';
import { asClinicId, type ClinicId, type CurrencyCode, type TimeZone } from '@denti-code-u3/types';

import type { SqliteDatabase } from '../connection.js';

/** SQLite `day_of_week` (0 = Sunday) → ISO-8601 weekday (1 = Monday … 7 = Sunday). */
const ISO_WEEKDAY_FROM_DOW = [7, 1, 2, 3, 4, 5, 6] as const;

function toIsoWeekday(dayOfWeek: number): number {
  return ISO_WEEKDAY_FROM_DOW[dayOfWeek] ?? dayOfWeek;
}

export class SQLiteClinicRepository implements ClinicRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findById(clinicId: ClinicId): Promise<Clinic | undefined> {
    const [row] = await this.db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);

    return row ? withOperatingHours(row, this.db) : undefined;
  }

  /**
   * The first active clinic — the same temporary bridge to authentication as
   * the PostgreSQL twin.
   */
  async getDefault(): Promise<Clinic | undefined> {
    const [row] = await this.db
      .select()
      .from(clinics)
      .where(eq(clinics.isActive, true))
      .orderBy(asc(clinics.id))
      .limit(1);

    return row ? withOperatingHours(row, this.db) : undefined;
  }
}

type ClinicRow = typeof clinics.$inferSelect;

/** The clinic plus its opening hours — two queries, exactly as on PostgreSQL. */
async function withOperatingHours(row: ClinicRow, db: SqliteDatabase): Promise<Clinic> {
  const hours = await db
    .select({
      dayOfWeek: clinicOperatingHours.dayOfWeek,
      opensAt: clinicOperatingHours.opensAt,
      closesAt: clinicOperatingHours.closesAt,
    })
    .from(clinicOperatingHours)
    .where(eq(clinicOperatingHours.clinicId, row.id))
    .orderBy(asc(clinicOperatingHours.dayOfWeek));

  return {
    id: asClinicId(row.id),
    name: row.name,
    ...(row.legalName === null ? {} : { legalName: row.legalName }),
    timeZone: row.timeZone as TimeZone,
    currency: row.currencyCode as CurrencyCode,
    operatingHours: hours.map(toOperatingHours),
    settings: {},
  };
}

/** `13:00:00` → `13:00`; both engines can hand back the longer form. */
function toLocalTime(value: string): string {
  return /^[0-9]{2}:[0-9]{2}/.test(value) ? value.slice(0, 5) : value;
}

function toOperatingHours(row: {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
}): ClinicOperatingHours {
  return {
    weekday: toIsoWeekday(row.dayOfWeek),
    opensAtLocalTime: row.opensAt === null ? '' : toLocalTime(row.opensAt),
    closesAtLocalTime: row.closesAt === null ? '' : toLocalTime(row.closesAt),
    isClosed: row.opensAt === null || row.closesAt === null,
  };
}
