/**
 * Inventory boundary schemas.
 *
 * `POST /api/v1/inventory/items` adds one item; `POST
 * /api/v1/inventory/items/:itemId/movements` applies one movement. The clinic is
 * the request scope and is never in either body (ADR 0014), and the item id on a
 * movement is on the path because the movement belongs to that item.
 *
 * Quantities are whole numbers and always positive on the wire — the movement's
 * type says which way the stock moves. Costs are integer minor units, the same
 * money representation every other boundary uses, capped at the column's range.
 * The domain still enforces the rules a schema cannot see (an outflow larger than
 * the stock on hand, a duplicate SKU across concurrent requests), because this
 * file can only read one request.
 */

import { z } from 'zod';

/** The largest integer a PostgreSQL `integer` column holds. */
const MAX_INTEGER = 2_147_483_647;

/** The movement vocabulary, mirrored from `packages/domain`'s enum. */
const stockMovementTypeSchema = z.enum(['PURCHASE', 'USAGE', 'ADJUSTMENT', 'RETURN', 'EXPIRED']);

/** Add one item to the clinic's inventory. */
export const createInventoryItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'An inventory item needs a name')
    .max(200, 'The item name is too long'),
  sku: z.string().trim().max(50, 'The SKU is too long').optional().nullable(),
  description: z.string().trim().max(2_000, 'The description is too long').optional().nullable(),
  unit: z.string().trim().max(50, 'The unit is too long').optional(),
  openingStock: z
    .number()
    .int()
    .nonnegative('Opening stock cannot be negative')
    .max(MAX_INTEGER, 'Opening stock is too large')
    .optional(),
  minStock: z
    .number()
    .int()
    .nonnegative('Minimum stock cannot be negative')
    .max(MAX_INTEGER, 'Minimum stock is too large')
    .optional(),
  costMinor: z
    .number()
    .int()
    .nonnegative('The unit cost cannot be negative')
    .max(MAX_INTEGER, 'The unit cost is too large')
    .optional(),
});

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

/** Apply one movement to one item. */
export const recordStockMovementSchema = z.object({
  type: stockMovementTypeSchema,
  quantity: z
    .number()
    .int()
    .positive('The quantity must be a whole number greater than zero')
    .max(MAX_INTEGER, 'The quantity is too large'),
  unitCostMinor: z
    .number()
    .int()
    .nonnegative('The unit cost cannot be negative')
    .max(MAX_INTEGER, 'The unit cost is too large')
    .optional()
    .nullable(),
  reference: z.string().trim().max(200, 'The reference is too long').optional().nullable(),
  notes: z.string().trim().max(2_000, 'The notes are too long').optional().nullable(),
});

export type RecordStockMovementInput = z.infer<typeof recordStockMovementSchema>;
