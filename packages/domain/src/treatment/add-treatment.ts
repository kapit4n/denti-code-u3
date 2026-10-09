/**
 * Adding a treatment to the clinic's catalogue — the write side of
 * `ports/index.ts`'s `TreatmentCatalogueItem`.
 *
 * `treatment.ts` draws a distinction the rest of this feature keeps: the catalogue
 * (what could be done) and the record (what was done). This file is the catalogue's
 * only write; `visit-treatment-records.ts` is the record's. The catalogue row is
 * the one a visit record, a plan item and a charge all name, so adding one is a
 * clinic administration act, not a clinical act — there is no visit to read first,
 * and the row carries its own `clinic_id` (the tenant is in the table, the way a
 * charge's is).
 *
 * **What validates what.** The endpoint schema trims, caps lengths, and refuses a
 * malformed number at the door; the rules below mirror it so both sides refuse the
 * same shapes, the habit every write body in this product keeps (ADR 0024). What the
 * schema cannot say is *how* the row is built, and that is here: a blank code or
 * description is dropped to `null` (an empty string is "typed and then forgotten",
 * and a catalogue that cannot tell "no code" from "a code that was blank" is lying
 * about both); a missing price is zero, a missing active flag is true. A duplicate
 * code is refused by the database's `(clinic_id, code)` unique index — the only
 * place two concurrent writers are both visible — and the repositories translate
 * that refusal to `DUPLICATED_RECORD`, the same code the register's record
 * number answers.
 *
 * `id` comes from the server and nothing above is optimistic: the row that is
 * stored is the row the caller is handed back, with the id it will be read by.
 * The row's own `created_at`/`updated_at` are the database's bookkeeping, defaulted
 * by the table as registration's are — a catalogue row is not a clinical fact, so
 * no domain clock is spent on it.
 */
import type { ClinicId, TreatmentId } from '@denti-code-u3/types';

import { DomainError } from '../shared/errors.js';
import type { TreatmentCatalogueItem, TreatmentRepository } from '../ports/index.js';

/** The shape of a catalogue row about to be written, in domain terms. */
export interface NewTreatmentCatalogueItem {
  /** Unique per clinic, and nullable — a catalogue may have unnamed rows. */
  readonly code?: string | null;
  readonly name: string;
  readonly description?: string | null;
  /** Estimated clinical minutes; the schema refuses zero and negatives. */
  readonly defaultDurationMinutes?: number | null;
  /** Base price in minor units of the clinic currency. Never a float. */
  readonly defaultPriceMinor?: number;
  readonly isActive?: boolean;
}

export interface AddTreatmentDependencies {
  readonly treatments: TreatmentRepository;
  /** The id is the server's, so the row stored is the id the caller is handed back. */
  readonly newId: () => TreatmentId;
}

/**
 * Add one treatment to the catalogue of the clinic, refusing the shapes the
 * endpoint schema lets through that are still not a treatment.
 *
 * The name is the one non-negotiable — it is `not null` in the table and the one
 * string a picker always has to draw. The price is the money this product never
 * lets a boundary get wrong twice (integer minor units, never negative). The
 * duration is whole positive minutes when present.
 */
export async function addTreatment(
  clinicId: ClinicId,
  input: NewTreatmentCatalogueItem,
  dependencies: AddTreatmentDependencies,
): Promise<TreatmentCatalogueItem> {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new DomainError('INVALID_INPUT', 'A treatment needs a name', { field: 'name' });
  }
  if (name.length > 200) {
    throw new DomainError('INVALID_INPUT', 'The treatment name is too long', { field: 'name' });
  }

  const defaultPriceMinor = input.defaultPriceMinor ?? 0;

  if (!Number.isInteger(defaultPriceMinor) || defaultPriceMinor < 0) {
    throw new DomainError('INVALID_INPUT', 'A treatment price cannot be negative', {
      field: 'defaultPriceMinor',
    });
  }

  const defaultDurationMinutes = input.defaultDurationMinutes ?? null;

  if (
    defaultDurationMinutes !== null &&
    (!Number.isInteger(defaultDurationMinutes) || defaultDurationMinutes < 1)
  ) {
    throw new DomainError('INVALID_INPUT', 'A treatment duration must be whole positive minutes', {
      field: 'defaultDurationMinutes',
    });
  }

  const item: TreatmentCatalogueItem = {
    id: dependencies.newId(),
    code: input.code?.trim() || null,
    name,
    description: input.description?.trim() || null,
    defaultDurationMinutes,
    defaultPriceMinor,
    isActive: input.isActive ?? true,
  };

  await dependencies.treatments.add(clinicId, item);

  return item;
}
