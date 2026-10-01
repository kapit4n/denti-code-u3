/**
 * Treatments are the clinic's service catalogue. A `Treatment` is a proposal
 * (what could be done); a `TreatmentRecord` is a fact (what was actually done in
 * a visit).
 */
import type { MoneyAmount } from '../billing/money.js';

export const TREATMENT_CATEGORIES = [
  'DIAGNOSIS',
  'PREVENTIVE',
  'RESTORATIVE',
  'ENDODONTICS',
  'PERIODONTICS',
  'SURGICAL',
  'ORTHODONTICS',
  'PROSTHODONTICS',
  'PEDIATRICS',
  'OTHER',
] as const;

export type TreatmentCategory = (typeof TREATMENT_CATEGORIES)[number];

export interface Treatment {
  readonly id: string;
  readonly clinicId: string;
  readonly code: string;
  readonly name: string;
  readonly category: TreatmentCategory;
  readonly defaultDurationMinutes: number;
  readonly defaultPrice: MoneyAmount;
}
