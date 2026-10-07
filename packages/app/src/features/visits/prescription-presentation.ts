/**
 * How a medication route is shown.
 *
 * The enum lives in the domain (`MEDICATION_ROUTES`) and the column holds the same
 * value; this file only gives each value a sentence a clinician reads. The record is
 * exhaustive over the route type on purpose, the same discipline the status tone
 * tables keep: a route added to the domain fails to compile here rather than
 * rendering as whatever the fallback picks.
 */

import { MEDICATION_ROUTES, type MedicationRoute } from '@denti-code-u3/domain';

const MEDICATION_ROUTE_LABELS: Readonly<Record<MedicationRoute, string>> = {
  ORAL: 'Oral',
  TOPICAL: 'Topical',
  INHALATION: 'Inhaled',
  INJECTION: 'Injection',
  RECTAL: 'Rectal',
  OTHER: 'Other',
};

export function medicationRouteLabel(route: MedicationRoute): string {
  return MEDICATION_ROUTE_LABELS[route];
}

/** The picker's choices, in the domain's order. */
export const MEDICATION_ROUTE_OPTIONS = MEDICATION_ROUTES.map((route) => ({
  route,
  label: MEDICATION_ROUTE_LABELS[route],
}));
