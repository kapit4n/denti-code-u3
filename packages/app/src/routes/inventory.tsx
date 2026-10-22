/**
 * The inventory page.
 *
 * Thin on purpose: the page is a feature component like every other screen, so it
 * can be tested with a stub `fetch` and a router that knows only this route. The
 * sidebar's Inventory row has pointed here since the shell was built; until this
 * file existed it was a 404.
 */

import { createFileRoute } from '@tanstack/react-router';

import { InventoryPage } from '../features/inventory/components/inventory-page.js';

export const Route = createFileRoute('/inventory')({
  component: InventoryPage,
});
