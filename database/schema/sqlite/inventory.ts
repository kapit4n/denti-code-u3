/**
 * Inventory: consumable stock and its movements.
 *
 * The SQLite twin of `database/schema/inventory.ts`. The movement table is an
 * append-only ledger — the current stock level is derived from the sum of the
 * movements — and `items.stock` is a cached projection updated in the same
 * transaction, on both engines.
 */

import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { STOCK_MOVEMENT_TYPES } from '@denti-code-u3/domain';

import { nowDefault, uuidDefault } from './defaults.js';
import { enumCheck } from './enum-check.js';
import { clinics, users } from './organization.js';

export const inventoryItems = sqliteTable(
  'inventory_items',
  {
    id: text('id').primaryKey().default(uuidDefault),
    clinicId: text('clinic_id')
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sku: text('sku'),
    description: text('description'),
    /** e.g. `unit`, `box`, `ml`. */
    unit: text('unit').notNull().default('unit'),
    /** Cached projection of `stock_movements`; updated in the same transaction. */
    stock: integer('stock').notNull().default(0),
    minStock: integer('min_stock').notNull().default(0),
    /** Cost per unit in minor units of the clinic currency. */
    costMinor: integer('cost_minor').notNull().default(0),
    currency: text('currency'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('inventory_items_clinic_active_idx').on(table.clinicId, table.isActive),
    uniqueIndex('inventory_items_clinic_sku_uq').on(table.clinicId, table.sku),
  ],
);

export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: text('id').primaryKey().default(uuidDefault),
    itemId: text('item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    type: text('type', { enum: STOCK_MOVEMENT_TYPES }).notNull(),
    /** Always positive; the `type` decides whether it is added or removed. */
    quantity: integer('quantity').notNull(),
    unitCostMinor: integer('unit_cost_minor'),
    reference: text('reference'),
    notes: text('notes'),
    performedBy: text('performed_by').references(() => users.id, { onDelete: 'set null' }),
    performedAt: integer('performed_at', { mode: 'timestamp_ms' }).notNull().default(nowDefault),
  },
  (table) => [
    index('stock_movements_item_performed_at_idx').on(table.itemId, table.performedAt),
    check('stock_movements_quantity_positive', sql`${table.quantity} > 0`),
    enumCheck('stock_movements_type_in_values', 'type', STOCK_MOVEMENT_TYPES),
  ],
);
