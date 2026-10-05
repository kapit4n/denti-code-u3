/**
 * Dentist persistence, on PostgreSQL.
 *
 * The clinic's bookable clinicians, and the first implementation of a port that had
 * been declared since session 8 with nobody calling it. The shape it returns is the
 * `DentistSummary` the booking form needs: a name to choose, a speciality to
 * disambiguate two clinicians with the same name, and the colour the clinic gave
 * them.
 *
 * **Two properties worth the same care as the patient repository's:**
 *
 *  - **Clinic scope is a parameter.** No method here can read a row without a
 *    `ClinicId`, so a dentist from another clinic cannot be listed by forgetting a
 *    filter (ADR 0014).
 *  - **Deactivated clinicians are listed, not hidden.** `is_active` is a flag the
 *    caller decides about, never a filter this method applies on its own. A
 *    clinician who has left still appears on the appointments they worked, and
 *    hiding the row would leave those appointments naming nobody.
 *
 * The order is by folded name, and the folding is not decoration: the database runs
 * with `--locale=C`, so an unfenced `ORDER BY full_name` puts `Ñuñez` after `Vargas`
 * and every accented clinician at the bottom of a dropdown.
 */

import type { DentistListRequest, DentistRepository, DentistSummary } from '@denti-code-u3/domain';
import { asDentistId, type ClinicId, type DentistId } from '@denti-code-u3/types';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { dentists } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { foldable } from '../postgres/fold-accents.js';

/** The columns a summary is made of, named once for both queries below. */
const summaryColumns = {
  id: dentists.id,
  userId: dentists.userId,
  fullName: dentists.fullName,
  speciality: dentists.speciality,
  color: dentists.color,
  isActive: dentists.isActive,
} as const;

export class DrizzleDentistRepository implements DentistRepository {
  constructor(private readonly db: DentiDatabase) {}

  async listByClinic(
    clinicId: ClinicId,
    request: DentistListRequest = {},
  ): Promise<readonly DentistSummary[]> {
    const rows = await this.db
      .select(summaryColumns)
      .from(dentists)
      .where(this.scope(clinicId, request))
      // Folded, then sorted, then `id` as a tiebreak: two clinicians can share a
      // name, and a list whose order changes between two identical requests is a
      // list that looks like it is shuffling.
      .orderBy(asc(foldable(dentists.fullName)), asc(dentists.id));

    return rows.map(toSummary);
  }

  async findById(clinicId: ClinicId, dentistId: DentistId): Promise<DentistSummary | undefined> {
    const [row] = await this.db
      .select(summaryColumns)
      .from(dentists)
      // Both halves of the key: an id belonging to another clinic is not found, not
      // refused, because saying it exists elsewhere is itself a disclosure.
      .where(and(eq(dentists.clinicId, clinicId), eq(dentists.id, dentistId)))
      .limit(1);

    return row ? toSummary(row) : undefined;
  }

  /**
   * `clinic_id`, plus `is_active` when the caller asked for it.
   *
   * `request.onlyActive ? … : undefined` is the same truthiness the patient search
   * uses, so "absent" means the same thing in both places: no filter.
   */
  private scope(clinicId: ClinicId, request: DentistListRequest): SQL | undefined {
    return and(
      eq(dentists.clinicId, clinicId),
      request.onlyActive ? eq(dentists.isActive, true) : undefined,
    );
  }
}

function toSummary(row: {
  id: string;
  userId: string | null;
  fullName: string;
  speciality: string | null;
  color: string | null;
  isActive: boolean;
}): DentistSummary {
  return {
    id: asDentistId(row.id),
    userId: row.userId,
    fullName: row.fullName,
    speciality: row.speciality,
    color: row.color,
    isActive: row.isActive,
  };
}
