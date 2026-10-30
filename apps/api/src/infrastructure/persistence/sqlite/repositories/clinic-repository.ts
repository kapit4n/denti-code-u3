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

import { and, asc, eq, notInArray } from 'drizzle-orm';

import { clinics, clinicOperatingHours } from '@denti-code-u3/database/schema/sqlite';
import type {
  Clinic,
  ClinicOperatingHours,
  ClinicRepository,
  ClinicSettingsUpdate,
} from '@denti-code-u3/domain';
import { asClinicId, type ClinicId, type CurrencyCode, type TimeZone } from '@denti-code-u3/types';

import type { SqliteDatabase } from '../connection.js';

/** SQLite `day_of_week` (0 = Sunday) → ISO-8601 weekday (1 = Monday … 7 = Sunday). */
const ISO_WEEKDAY_FROM_DOW = [7, 1, 2, 3, 4, 5, 6] as const;

const DOW_FROM_ISO_WEEKDAY: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 0,
};

function toIsoWeekday(dayOfWeek: number): number {
  return ISO_WEEKDAY_FROM_DOW[dayOfWeek] ?? dayOfWeek;
}

export class SQLiteClinicRepository implements ClinicRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findById(clinicId: ClinicId): Promise<Clinic | undefined> {
    const [row] = await this.db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);

    return row ? withOperatingHours(row, this.db) : undefined;
  }

  async updateSettings(
    clinicId: ClinicId,
    settings: ClinicSettingsUpdate,
  ): Promise<Clinic | undefined> {
    let exists = false;

    this.db.transaction((tx) => {
      const updated = tx
        .update(clinics)
        .set({
          name: settings.name,
          legalName: settings.legalName,
          taxId: settings.taxId,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
          timeZone: settings.timeZone,
          currencyCode: settings.currency,
          updatedAt: new Date(),
        })
        .where(eq(clinics.id, clinicId))
        .returning({ id: clinics.id })
        .all();

      if (updated.length === 0) {
        return;
      }
      exists = true;

      const days = settings.operatingHours.map(
        (hours) => DOW_FROM_ISO_WEEKDAY[hours.weekday] ?? hours.weekday,
      );

      for (const hours of settings.operatingHours) {
        const dayOfWeek = DOW_FROM_ISO_WEEKDAY[hours.weekday] ?? hours.weekday;
        tx.insert(clinicOperatingHours)
          .values({
            clinicId,
            dayOfWeek,
            opensAt: hours.isClosed ? null : hours.opensAtLocalTime,
            closesAt: hours.isClosed ? null : hours.closesAtLocalTime,
          })
          .onConflictDoUpdate({
            target: [clinicOperatingHours.clinicId, clinicOperatingHours.dayOfWeek],
            set: {
              opensAt: hours.isClosed ? null : hours.opensAtLocalTime,
              closesAt: hours.isClosed ? null : hours.closesAtLocalTime,
            },
          })
          .run();
      }

      if (days.length === 0) {
        tx.delete(clinicOperatingHours).where(eq(clinicOperatingHours.clinicId, clinicId)).run();
      } else {
        tx.delete(clinicOperatingHours)
          .where(
            and(
              eq(clinicOperatingHours.clinicId, clinicId),
              notInArray(clinicOperatingHours.dayOfWeek, days),
            ),
          )
          .run();
      }
    });

    return exists ? this.findById(clinicId) : undefined;
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
    ...(row.taxId === null ? {} : { taxId: row.taxId }),
    ...(row.address === null ? {} : { address: row.address }),
    ...(row.phone === null ? {} : { phone: row.phone }),
    ...(row.email === null ? {} : { email: row.email }),
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
