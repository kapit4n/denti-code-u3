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

import type { Translate, TranslationKey } from '../../i18n/index.js';

const MEDICATION_ROUTE_KEY: Readonly<Record<MedicationRoute, TranslationKey>> = {
  ORAL: 'visits.medicationRoute.ORAL',
  TOPICAL: 'visits.medicationRoute.TOPICAL',
  INHALATION: 'visits.medicationRoute.INHALATION',
  INJECTION: 'visits.medicationRoute.INJECTION',
  RECTAL: 'visits.medicationRoute.RECTAL',
  OTHER: 'visits.medicationRoute.OTHER',
};

export function medicationRouteLabel(t: Translate, route: MedicationRoute): string {
  return t(MEDICATION_ROUTE_KEY[route]);
}

/** The picker's choices, in the domain's order. */
export function medicationRouteOptions(t: Translate): readonly {
  readonly route: MedicationRoute;
  readonly label: string;
}[] {
  return MEDICATION_ROUTES.map((route) => ({
    route,
    label: medicationRouteLabel(t, route),
  }));
}
