/**
 * The treatment catalogue.
 *
 * Thin on purpose: the page is a feature component like every other screen's, so
 * it can be tested with a stub `fetch` and a router that knows only this route.
 * The sidebar's link has pointed here since the shell was built; until this file
 * existed it was the one nav row that answered 404.
 */

import { createFileRoute } from '@tanstack/react-router';

import { TreatmentCatalogue } from '../features/treatments/components/treatment-catalogue.js';

export const Route = createFileRoute('/treatments')({
  component: TreatmentCatalogue,
});
