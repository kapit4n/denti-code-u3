/**
 * Clinic persistence, on PostgreSQL.
 *
 * Two commitments:
 *
 *  - **The clinic row is authoritative for its own day.** `time_zone` is what
 *    "today" means for every reporting window and every calendar column. The API's
 *    `CLINIC_TIME_ZONE` is a fallback for a clinic row that cannot be read, not an
 *    override: two clinics on one deployment must not share a day because the
 *    process was started with one value.
 *  - **Weekday numbering is translated, not copied.** The column is `0 = Sunday …
 *    6 = Saturday` (PostgreSQL's `extract(dow)`), the domain is `1 = Monday …
 *    7 = Sunday` (ISO-8601). Every conversion is where a Sunday can become a
 *    Saturday and the clinic opens when it is shut.
 */

import { asc, eq } from 'drizzle-orm';

import { clinics, clinicOperatingHours } from '@denti-code-u3/database/schema';
import type { Clinic, ClinicOperatingHours, ClinicRepository } from '@denti-code-u3/domain';
import { asClinicId, type ClinicId, type CurrencyCode, type TimeZone } from '@denti-code-u3/types';

import type { DentiDatabase } from '../postgres/connection.js';

/**
 * PostgreSQL `extract(dow)` → ISO-8601 weekday.
 *
 * Sunday is 0 in the database and 7 in ISO, so Sunday is the one value that moves.
 */
const ISO_WEEKDAY_FROM_DOW = [7, 1, 2, 3, 4, 5, 6] as const;

function toIsoWeekday(dayOfWeek: number): number {
  return ISO_WEEKDAY_FROM_DOW[dayOfWeek] ?? dayOfWeek;
}

export class DrizzleClinicRepository implements ClinicRepository {
  constructor(private readonly db: DentiDatabase) {}

  async findById(clinicId: ClinicId): Promise<Clinic | undefined> {
    const [row] = await this.db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);

    return row ? withOperatingHours(row, this.db) : undefined;
  }

  /**
   * The first active clinic.
   *
   * A temporary bridge. There is no authentication yet, so a browser has no clinic
   * id of its own to ask for and the API falls back to the `CLINIC_ID` in the
   * environment. It disappears with authentication, at which point every request
   * carries a clinic and this has no caller.
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

/**
 * The clinic plus its opening hours.
 *
 * Two queries rather than a join, because a join would repeat the clinic row once
 * per weekday and then need grouping to undo. A clinic has seven rows at most.
 */
async function withOperatingHours(row: ClinicRow, db: DentiDatabase): Promise<Clinic> {
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
    // The `settings` column does not exist yet. Until it does, `Clinic.settings`
    // stays an empty record rather than a guess at what belongs in it.
    settings: {},
  };
}

/**
 * `13:00:00` → `13:00`.
 *
 * PostgreSQL's `time` carries seconds and microseconds, and the driver hands them
 * over. Every consumer wants a wall-clock time of day — the domain's
 * `opensAtLocalTime`, and FullCalendar's `businessHours`, which parses `HH:MM` and
 * ignores anything after it. Shipping the raw value would leave the calendar
 * silently shading the wrong hours.
 */
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
    // A null opening time is how the database says the clinic does not open that
    // day, and the closing time only means anything alongside it.
    isClosed: row.opensAt === null || row.closesAt === null,
  };
}
