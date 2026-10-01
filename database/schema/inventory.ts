/**
 * Inventory: consumable stock and its movements.
 *
 * The movement table is an append-only ledger — the current stock level is
 * derived from the sum of the movements. An append-only ledger can be audited,
 * which a single mutable `stock` column cannot. `items.stock` is a cached
 * projection updated in the same transaction, so the common read is still cheap.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { stockMovementTypeEnum } from './enums.js';
import { clinics, users } from './organization.js';

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id')
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
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inventory_items_clinic_active_idx').on(table.clinicId, table.isActive),
    uniqueIndex('inventory_items_clinic_sku_uq').on(table.clinicId, table.sku),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    type: stockMovementTypeEnum('type').notNull(),
    /** Always positive; the `type` decides whether it is added or removed. */
    quantity: integer('quantity').notNull(),
    unitCostMinor: integer('unit_cost_minor'),
    reference: text('reference'),
    notes: text('notes'),
    performedBy: uuid('performed_by').references(() => users.id, { onDelete: 'set null' }),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_movements_item_performed_at_idx').on(table.itemId, table.performedAt),
    check('stock_movements_quantity_positive', sql`${table.quantity} > 0`),
  ],
);

export const inventoryItemRelations = relations(inventoryItems, ({ one, many }) => ({
  clinic: one(clinics, { fields: [inventoryItems.clinicId], references: [clinics.id] }),
  movements: many(stockMovements),
}));

export const stockMovementRelations = relations(stockMovements, ({ one }) => ({
  item: one(inventoryItems, { fields: [stockMovements.itemId], references: [inventoryItems.id] }),
  performedByUser: one(users, {
    fields: [stockMovements.performedBy],
    references: [users.id],
  }),
}));
